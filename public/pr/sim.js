/* sim.js — the simulation engine.
 *
 * A tile-based, agent-driven god-sim in the spirit of WorldBox. Units (one per
 * tile) wander, settle cities, claim territory, and wage war; cities grow and
 * spawn more units; relationships decay into wars and recover into truces;
 * disloyal frontier cities rebel; and La Resistencia keeps the
 * Independentistas from ever being fully wiped out.
 *
 * The engine is deliberately self-contained: render.js reads its public arrays
 * and powers.js calls its mutator methods.
 */

import {
  COLS, ROWS, TILE, MOVE_COST, GROWTH_MOD, DEFENSE_MOD,
  idx, inBounds, isOcean, isLand, isBuildable, isRough,
  municipioAt, MUNI_NAMES, MUNI_CENTROIDS, nearestLand,
} from './map.js?v=18';
import { CITY_NAMES, FLAVOR_EVENTS, CIV_INDEX, CITIZEN_NAMES } from './civs.js?v=18';

// --- Tunables (scaled for the larger real-coastline map ~17.5k land tiles) --
const MAX_UNITS = 2200;
const MAX_CITIES = 44;
const MIN_CITY_DIST = 12;
const UNIT_SPEED = 0.7;
const RETARGET_EVERY = 12;
const TERRITORY_EVERY = 6;
const WAR_THRESHOLD = 32;
const PEACE_THRESHOLD = 62;
const DOMINANCE = 0.62; // fraction of land owned to win (juego más largo)
const EVENT_CAP = 320; // historial más largo
const SUMMARY_EVERY = 240; // "State of the Island" cadence
const RAZE_CHANCE = 0.35; // chance a fallen city is razed instead of captured

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld({ tiles, civs, starts, seed = 1 }) {
  const rng = mulberry32(seed);
  const N = civs.length;

  const world = {
    tiles,
    civs,
    COLS,
    ROWS,
    rng,
    tick: 0,
    units: [],
    cities: [],
    owner: new Int16Array(COLS * ROWS).fill(-1),
    occ: new Int32Array(COLS * ROWS).fill(-1), // unit array index per tile
    rel: [], // relationship matrix
    war: [], // boolean war matrix
    stats: civs.map(() => ({ pop: 0, units: 0, cities: 0, territory: 0 })),
    momentum: civs.map(() => 1), // territory leaders fight harder (snowball)
    events: [],
    animals: [], // ambient wildlife (sheep/wolf/fish/bird)
    effects: [], // transient hazards (dragon/ufo/volcano/tornado)
    free: [], // librepensadores — undecided people the parties recruit
    leaders: civs.map(() => null), // the ruler unit of each party
    recruited: civs.map(() => 0), // librepensadores convencidos por cada partido
    budget: civs.map(() => 5000), // presupuesto inicial $5,000
    budgetFactor: civs.map(() => 1), // multiplicador de campaña según dinero
    kills: civs.map(() => 0), // bajas acumuladas causadas por cada partido
    prAnchor: civs.map(() => null), // destino en la isla grande (al migrar)
    history: [], // muestras {pop,terr,budget,free} para gráficas
    winner: null,
    landCount: 0,
    nextUnitId: 1,
    nextCityId: 1,
    nextAnimalId: 1,
    reviveCount: 0,
  };

  for (let i = 0; i < tiles.length; i++) if (isLand(tiles[i])) world.landCount++;

  // Relationship matrix starts neutral-ish.
  for (let i = 0; i < N; i++) {
    world.rel[i] = [];
    world.war[i] = [];
    for (let j = 0; j < N; j++) {
      world.rel[i][j] = i === j ? 100 : 44;
      world.war[i][j] = false;
    }
  }
  // Alianza de País: PIP y Victoria Ciudadana empiezan aliados.
  if (CIV_INDEX.ind != null && CIV_INDEX.mvc != null) {
    const a = CIV_INDEX.ind, b = CIV_INDEX.mvc;
    world.rel[a][b] = world.rel[b][a] = 75;
  }

  // Carisma: capacidad de atraer librepensadores (la brutalidad espanta).
  world.charisma = civs.map((c) => Math.max(0.3,
    c.traits.diplomacy + 0.5 * c.traits.intelligence - 0.4 * c.traits.brutality +
    (c.specials.viral ? 3 : 0) + (c.specials.recruiter ? 2 : 0)));

  // ---- Helpers ----------------------------------------------------------
  const t = world;
  const tileAt = (x, y) => t.tiles[idx(x, y)];
  const occAt = (x, y) => (inBounds(x, y) ? t.occ[idx(x, y)] : -2);

  function log(text, civIndex = null) {
    t.events.unshift({ tick: t.tick, text, civ: civIndex });
    if (t.events.length > EVENT_CAP) t.events.pop();
  }
  world.log = log;

  function freeNeighbor(x, y) {
    const dirs = shuffleDirs();
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny) && isLand(t.tiles[idx(nx, ny)]) && t.occ[idx(nx, ny)] === -1) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  const DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  function shuffleDirs() {
    const d = DIRS.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function spawnUnit(civIndex, x, y, allowSea = false) {
    if (t.units.length >= MAX_UNITS) return null;
    const okHere = inBounds(x, y) && t.occ[idx(x, y)] === -1 &&
      (isLand(t.tiles[idx(x, y)]) || allowSea);
    const spot = okHere ? { x, y }
      : freeNeighbor(x, y) || (allowSea ? nearestFreeAny(x, y) : nearestFree(x, y));
    if (!spot) return null;
    const c = t.civs[civIndex];
    const maxHp = 12 + c.traits.resilience;
    const u = {
      id: t.nextUnitId++,
      civ: civIndex,
      x: spot.x,
      y: spot.y,
      hp: maxHp,
      maxHp,
      age: 0,
      maxAge: 520 + c.traits.resilience * 90 + ((rng() * 200) | 0),
      move: 0,
      tx: -1,
      ty: -1,
      kills: 0,
      dead: false,
      isLeader: false,
      rulerName: null,
      name: CITIZEN_NAMES[(rng() * CITIZEN_NAMES.length) | 0],
      since: 0,
      joined: t.tick, // turno en que se unió (antigüedad en el partido)
      killLog: [], // historial de bajas (para líderes)
    };
    const ai = t.units.push(u) - 1;
    t.occ[idx(spot.x, spot.y)] = ai;
    return u;
  }
  world.spawnUnit = spawnUnit;

  function nearestFree(x, y) {
    for (let r = 1; r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (inBounds(nx, ny) && isLand(t.tiles[idx(nx, ny)]) && t.occ[idx(nx, ny)] === -1) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return null;
  }

  // Igual que nearestFree pero acepta mar (para empezar "en botes" en Culebra).
  function nearestFreeAny(x, y) {
    for (let r = 1; r < 22; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny) && t.occ[idx(nx, ny)] === -1) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  function foundCity(civIndex, x, y, startPop = 5) {
    if (t.cities.length >= MAX_CITIES) return null;
    if (!inBounds(x, y) || !isBuildable(t.tiles[idx(x, y)])) return null;
    const used = new Set(t.cities.map((c) => c.name));
    let name = CITY_NAMES[(rng() * CITY_NAMES.length) | 0];
    if (used.has(name)) name = name + ' ' + (t.nextCityId);
    const muni = MUNI_NAMES[municipioAt(x, y)] || 'la costa';
    const city = {
      id: t.nextCityId++,
      civ: civIndex,
      x,
      y,
      pop: startPop,
      hp: 26,
      maxHp: 26,
      name,
      muni,
      loyalty: 100,
      besieged: false,
      flash: 30, // destello al fundarse/descubrirse
      siegeBy: new Array(N).fill(0),
    };
    t.cities.push(city);
    return city;
  }
  world.foundCity = foundCity;

  // ---- Inicio del mundo --------------------------------------------------
  // Todos los líderes empiezan en (o junto a) Culebra y deben navegar a la
  // isla grande de Puerto Rico para conquistar y reclutar.
  const culIdx = MUNI_NAMES.indexOf('Culebra');
  const CUL = culIdx >= 0
    ? { x: MUNI_CENTROIDS[culIdx][0], y: MUNI_CENTROIDS[culIdx][1] }
    : { x: Math.round(COLS * 0.97), y: Math.round(ROWS * 0.33) };

  function seed() {
    for (let i = 0; i < N; i++) {
      // destino en la isla grande (su "patria" futura)
      t.prAnchor[i] = nearestLand(t.tiles, starts[i % starts.length].x, starts[i % starts.length].y);
      const st = t.civs[i].start || { units: 6, cityPop: 8 };
      // fuerza inicial alrededor de Culebra (en tierra o en botes en el mar)
      const total = st.units + 2;
      for (let k = 0; k < total; k++) spawnUnit(i, CUL.x, CUL.y, true);
    }
    log('⛵ Los líderes parten desde Culebra rumbo a Puerto Rico.');
    seedAnimals();
    seedFree();
    for (let i = 0; i < N; i++) promoteLeader(i, true);
    recomputeTerritory();
    recomputeStats();
  }

  // ---- Librepensadores (indecisos a reclutar) ---------------------------
  const FREE_CAP = 520;
  function spawnFree(x, y) {
    if (t.free.length >= FREE_CAP) return null;
    const spot = inBounds(x, y) && isLand(t.tiles[idx(x, y)])
      ? { x, y } : nearestLandFree(x, y);
    if (!spot) return null;
    const f = { id: t.nextAnimalId++, x: spot.x, y: spot.y, age: 0, lean: (rng() * N) | 0, openness: 0.4 + rng() * 0.6 };
    t.free.push(f);
    return f;
  }
  world.spawnFree = spawnFree;

  function seedFree() {
    for (let i = 0; i < 240; i++) {
      const x = (rng() * COLS) | 0, y = (rng() * ROWS) | 0;
      if (isLand(t.tiles[idx(x, y)])) spawnFree(x, y);
    }
  }

  function updateFree() {
    // Slowly replenish the undecided population (a new generation of voters).
    if (t.tick % 20 === 0 && t.free.length < 200) {
      for (let k = 0; k < 4; k++) { const x = (rng() * COLS) | 0, y = (rng() * ROWS) | 0; if (isLand(t.tiles[idx(x, y)])) spawnFree(x, y); }
    }
    const joined = [];
    for (let i = 0; i < t.free.length; i++) {
      const f = t.free[i];
      f.age++;
      // wander on land
      if ((t.tick + f.id) % 2 === 0) {
        const dx = ((rng() * 3) | 0) - 1, dy = ((rng() * 3) | 0) - 1;
        const nx = f.x + dx, ny = f.y + dy;
        if (inBounds(nx, ny) && isLand(t.tiles[idx(nx, ny)])) { f.x = nx; f.y = ny; }
      }
      // periodically weigh the nearby parties and maybe join one
      if ((t.tick + f.id) % 18 !== 0) continue;
      const inf = new Array(N).fill(0);
      const R = 5;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = f.x + dx, ny = f.y + dy;
          if (!inBounds(nx, ny)) continue;
          const oi = t.occ[idx(nx, ny)];
          if (oi >= 0 && t.units[oi] && !t.units[oi].dead) {
            const cv = t.units[oi].civ;
            const d = Math.hypot(dx, dy) || 1;
            inf[cv] += t.charisma[cv] * t.budgetFactor[cv] / d; // las campañas con plata convencen más
          }
        }
      }
      for (const c of t.cities) {
        const d = Math.hypot(c.x - f.x, c.y - f.y);
        if (d <= R + 3) inf[c.civ] += t.charisma[c.civ] * t.budgetFactor[c.civ] * 1.5 / (1 + d);
      }
      // a little loyalty to their initial leaning
      inf[f.lean] += 1.2;
      let bestCiv = -1, bestInf = 0;
      for (let c = 0; c < N; c++) if (inf[c] > bestInf) { bestInf = inf[c]; bestCiv = c; }
      if (bestCiv < 0) continue;
      const prob = Math.min(0.85, bestInf * 0.03 * f.openness);
      if (rng() < prob) {
        const u = spawnUnit(bestCiv, f.x, f.y);
        if (u) { joined.push(i); t.recruited[bestCiv]++; if (rng() < 0.05) log(`🧠 ${u.name} se unió a ${t.civs[bestCiv].name}.`, bestCiv); }
      }
    }
    if (joined.length) { const s = new Set(joined); t.free = t.free.filter((_, i) => !s.has(i)); }
  }

  function cullFree(cx, cy, r) {
    if (t.free.length) t.free = t.free.filter((f) => Math.hypot(f.x - cx, f.y - cy) > r);
  }

  // ---- Economía: presupuesto que sube y baja según el uso ---------------
  const broke = civs.map(() => false);
  function updateEconomy() {
    for (let i = 0; i < N; i++) {
      const s = t.stats[i];
      const income = s.cities * 8 + s.pop * 0.6 + s.territory * 0.12;
      const upkeep = s.units * 0.8; // mantener seguidores cuesta
      // la corrupción drena las arcas (más en los más brutales)
      const corr = t.civs[i].traits.brutality > 7 ? t.budget[i] * 0.03
        : (t.budget[i] > 0 ? t.budget[i] * 0.004 : 0);
      t.budget[i] += income - upkeep - corr;
      if (t.budget[i] < -3000) t.budget[i] = -3000;
      if (t.budget[i] > 50000) t.budget[i] = 50000;
      const b = t.budget[i];
      t.budgetFactor[i] = b > 0 ? 1 + Math.min(0.6, b / 8000) : 0.4;
      // historia: quiebra / recuperación
      if (b < 0 && !broke[i]) { broke[i] = true; log(`💸 ${t.civs[i].name} entra en quiebra; sus campañas se frenan.`, i); }
      else if (b > 800 && broke[i]) { broke[i] = false; log(`💵 ${t.civs[i].name} sanea sus finanzas.`, i); }
    }
  }

  // Estado actual del líder (qué está haciendo) — para la barra de estado.
  world.leaderStatus = function (i) {
    const l = t.leaders[i];
    if (!l || l.dead) return '— sin líder';
    if (l.x >= OFFSHORE_X) return '⛵ Navegando a Puerto Rico';
    if (anyWar(i)) return '⚔️ En campaña de guerra';
    for (const cy of t.cities) {
      if (cy.civ === i && Math.abs(cy.x - l.x) + Math.abs(cy.y - l.y) <= 4) return '🏛️ Gobernando su territorio';
    }
    if (t.budget[i] < 0) return '💸 Buscando fondos (en quiebra)';
    return '🚶 Recorriendo la isla';
  };

  // ---- Combat -----------------------------------------------------------
  function defenseFactor(unit) {
    const tile = t.tiles[idx(unit.x, unit.y)];
    let f = DEFENSE_MOD[tile];
    const c = t.civs[unit.civ];
    if (c.specials.guerrilla && isRough(tile)) f *= 1.6;
    if (c.specials.holdBonus && t.owner[idx(unit.x, unit.y)] === unit.civ) f *= 1.3;
    return f;
  }
  function attackPower(unit) {
    const c = t.civs[unit.civ];
    return 3 + c.traits.brutality * 0.7 + c.traits.aggression * 0.2;
  }

  function fight(attacker, defender) {
    const ac = t.civs[attacker.civ];
    let dmg = attackPower(attacker) * t.momentum[attacker.civ] * (0.7 + rng() * 0.6) / defenseFactor(defender);
    if (defender.isLeader) dmg *= 0.35; // los líderes van bien protegidos
    // Brutality: a chance to execute a wounded foe outright.
    if (defender.hp < 4 && rng() < ac.traits.brutality * 0.03) dmg = defender.hp + 1;
    defender.hp -= dmg;
    // Counterattack (weaker) if the defender survives.
    if (defender.hp > 0) {
      const counter = attackPower(defender) * 0.5 * (0.6 + rng() * 0.5) / defenseFactor(attacker);
      attacker.hp -= counter;
    }
    // Worsen relations between the two civs.
    adjustRel(attacker.civ, defender.civ, -0.6);
  }

  function adjustRel(a, b, delta) {
    if (a === b) return;
    t.rel[a][b] = Math.max(0, Math.min(100, t.rel[a][b] + delta));
    t.rel[b][a] = Math.max(0, Math.min(100, t.rel[b][a] + delta));
  }

  // ---- Targeting --------------------------------------------------------
  const OFFSHORE_X = Math.round(COLS * 0.82); // islas del este (Vieques/Culebra)
  function retarget(unit) {
    const c = t.civs[unit.civ];
    // Si aún está en las islas del este, navega hacia su patria en la isla grande.
    if (unit.x >= OFFSHORE_X && t.prAnchor[unit.civ]) {
      unit.tx = t.prAnchor[unit.civ].x;
      unit.ty = t.prAnchor[unit.civ].y;
      return;
    }
    const sight = Math.round(4 + c.traits.intelligence * 0.5);
    let enemy = null;
    let enemyDist = Infinity;
    let frontier = null;
    let frontierDist = Infinity;

    for (let dy = -sight; dy <= sight; dy++) {
      for (let dx = -sight; dx <= sight; dx++) {
        const nx = unit.x + dx;
        const ny = unit.y + dy;
        if (!inBounds(nx, ny)) continue;
        const tile = t.tiles[idx(nx, ny)];
        if (isOcean(tile)) continue;
        const d = dx * dx + dy * dy;
        // Hunt enemy units when at war.
        const oi = t.occ[idx(nx, ny)];
        if (oi >= 0) {
          const other = t.units[oi];
          if (other && other.civ !== unit.civ && t.war[unit.civ][other.civ] && d < enemyDist) {
            enemy = { x: nx, y: ny };
            enemyDist = d;
          }
        }
        // Expansion frontier: nearby land not owned by us.
        const own = t.owner[idx(nx, ny)];
        if (own !== unit.civ && d < frontierDist && d > 0) {
          // PNP "Anexión": bias strongly toward the coast.
          let score = d;
          if (c.specials.coastBonus && tile === TILE.BEACH) score *= 0.4;
          if (score < frontierDist) {
            frontier = { x: nx, y: ny };
            frontierDist = score;
          }
        }
      }
    }

    // When at war, look for the nearest enemy city to march on (cheap pass
    // over the city list). This is what actually moves the front lines.
    let enemyCity = null;
    let cityDist = 26 * 26;
    if (anyWar(unit.civ)) {
      for (const city of t.cities) {
        if (!t.war[unit.civ][city.civ]) continue;
        const dd = (city.x - unit.x) ** 2 + (city.y - unit.y) ** 2;
        if (dd < cityDist) { cityDist = dd; enemyCity = city; }
      }
    }

    // Aggressive civs chase enemies; everyone else expands or wanders.
    const wantsFight = enemy && rng() < 0.4 + c.traits.aggression * 0.06;
    const wantsSiege = enemyCity && rng() < 0.3 + c.traits.aggression * 0.06;
    if (wantsFight) {
      unit.tx = enemy.x;
      unit.ty = enemy.y;
    } else if (wantsSiege) {
      unit.tx = enemyCity.x;
      unit.ty = enemyCity.y;
    } else if (frontier && rng() < 0.35 + c.traits.expansion * 0.06) {
      unit.tx = frontier.x;
      unit.ty = frontier.y;
    } else {
      unit.tx = -1;
      unit.ty = -1;
    }
  }

  function stepToward(unit) {
    let best = null;
    let bestScore = Infinity;
    const hasTarget = unit.tx >= 0;
    for (const [dx, dy] of DIRS) {
      const nx = unit.x + dx;
      const ny = unit.y + dy;
      if (!inBounds(nx, ny)) continue;
      const tile = t.tiles[idx(nx, ny)];
      // Sólo se entra al mar con rumbo fijo (cruzar); al vagar se quedan en tierra.
      if (isOcean(tile) && !hasTarget) continue;
      const seaPenalty = isOcean(tile) ? 3 : 0;
      const score = hasTarget
        ? (nx - unit.tx) ** 2 + (ny - unit.ty) ** 2 + seaPenalty + rng() * 0.3
        : rng();
      if (score < bestScore) {
        bestScore = score;
        best = { x: nx, y: ny, tile };
      }
    }
    return best;
  }

  // ---- Per-unit update --------------------------------------------------
  function updateUnit(unit, ai) {
    unit.age++;
    if (unit.age > unit.maxAge || unit.hp <= 0) {
      killUnit(ai);
      return;
    }
    // Slow passive healing.
    if (unit.hp < unit.maxHp) unit.hp += 0.05;

    // Desafección: un seguidor descontento puede irse y volver a ser
    // librepensador (los líderes no desertan).
    if (!unit.isLeader && (t.tick + unit.id) % 40 === 0) {
      const civ = unit.civ;
      let discontent = 0;
      if (t.momentum[civ] < 0.9) discontent += (0.9 - t.momentum[civ]); // su partido va perdiendo
      if (t.budget[civ] < 0) discontent += 0.4; // partido en quiebra
      if (t.owner[idx(unit.x, unit.y)] !== civ) discontent += 0.22; // lejos de los suyos
      if (rng() < Math.min(0.5, discontent * 0.16)) {
        spawnFree(unit.x, unit.y);
        if (t.recruited[civ] > 0) t.recruited[civ]--;
        if (rng() < 0.04) log(`💔 ${unit.name} abandonó a ${t.civs[civ].name}.`, civ);
        killUnit(ai);
        return;
      }
    }

    if ((t.tick + unit.id) % RETARGET_EVERY === 0) retarget(unit);

    unit.move += UNIT_SPEED;
    const next = stepToward(unit);
    if (!next) return;
    const cost = MOVE_COST[next.tile];
    if (unit.move < cost) return;
    unit.move -= cost;

    const ni = idx(next.x, next.y);
    const occupant = t.occ[ni];
    if (occupant === -1) {
      // Move into the empty tile; paint it for our civ.
      t.occ[idx(unit.x, unit.y)] = -1;
      unit.x = next.x;
      unit.y = next.y;
      t.occ[ni] = ai;
      if (isLand(next.tile)) t.owner[ni] = unit.civ; // no se reclama el mar
      maybeFoundCity(unit);
    } else {
      const other = t.units[occupant];
      if (other && other.civ !== unit.civ && t.war[unit.civ][other.civ]) {
        fight(unit, other);
        if (other.hp <= 0) {
          unit.kills++; t.kills[unit.civ]++;
          if (unit.isLeader) {
            unit.killLog.push({ name: other.name, civ: other.civ, tick: t.tick });
            if (unit.killLog.length > 8) unit.killLog.shift();
          }
          killUnit(occupant);
        }
      }
      // Friendly or non-war neighbor: stay put this step.
    }
    // Siege any adjacent enemy city.
    siegeAdjacent(unit);
  }

  function maybeFoundCity(unit) {
    const c = t.civs[unit.civ];
    if (t.cities.length >= MAX_CITIES) return;
    const tile = t.tiles[idx(unit.x, unit.y)];
    if (!isBuildable(tile)) return;
    const myCities = t.stats[unit.civ].cities;
    const chance = 0.012 * (c.traits.expansion / 8) / (1 + myCities * 0.25);
    if (rng() > chance) return;
    // Respect spacing from existing cities.
    for (const city of t.cities) {
      const d = Math.abs(city.x - unit.x) + Math.abs(city.y - unit.y);
      if (d < MIN_CITY_DIST) return;
    }
    const city = foundCity(unit.civ, unit.x, unit.y, 5);
    if (city) log(`🏘️ ${c.name} fundó ${city.name} en ${city.muni}.`, unit.civ);
  }

  function siegeAdjacent(unit) {
    for (const [dx, dy] of DIRS) {
      const nx = unit.x + dx;
      const ny = unit.y + dy;
      if (!inBounds(nx, ny)) continue;
      const city = cityAt(nx, ny);
      if (city && city.civ !== unit.civ && t.war[unit.civ][city.civ]) {
        city.hp -= attackPower(unit) * 0.9 * t.momentum[unit.civ];
        city.besieged = true;
        city.siegeBy[unit.civ]++;
        adjustRel(unit.civ, city.civ, -0.2);
      }
    }
  }

  function cityAt(x, y) {
    for (const c of t.cities) if (c.x === x && c.y === y) return c;
    return null;
  }

  const deadUnits = new Set();
  function killUnit(ai) {
    const u = t.units[ai];
    if (!u) return;
    u.dead = true;
    if (t.occ[idx(u.x, u.y)] === ai) t.occ[idx(u.x, u.y)] = -1;
    deadUnits.add(ai);
  }

  function compactUnits() {
    if (deadUnits.size === 0) return;
    const next = [];
    for (let i = 0; i < t.units.length; i++) {
      if (deadUnits.has(i)) continue;
      const u = t.units[i];
      next.push(u);
    }
    t.units = next;
    deadUnits.clear();
    // Rebuild occupancy from the surviving units.
    t.occ.fill(-1);
    for (let i = 0; i < t.units.length; i++) {
      const u = t.units[i];
      t.occ[idx(u.x, u.y)] = i;
    }
  }

  // ---- City update ------------------------------------------------------
  function updateCities() {
    for (let i = t.cities.length - 1; i >= 0; i--) {
      const city = t.cities[i];
      const c = t.civs[city.civ];
      const tile = t.tiles[idx(city.x, city.y)];
      // Growth (the territorial leader's economy snowballs via momentum).
      city.pop += 0.045 * c.traits.growth * GROWTH_MOD[tile] * t.momentum[city.civ];
      if (city.pop > 45) city.pop = 45;
      // Spawn a citizen when ripe — cuesta dinero de campaña.
      if (city.pop >= 7 && t.units.length < MAX_UNITS && t.budget[city.civ] > 40) {
        const spot = freeNeighbor(city.x, city.y);
        if (spot) {
          spawnUnit(city.civ, spot.x, spot.y);
          city.pop -= 4;
          t.budget[city.civ] -= 40;
        }
      }
      // Regenerate only when not under active siege.
      if (!city.besieged && city.hp < city.maxHp) city.hp += 0.3;
      // Fallen city: captured by its strongest besieger, or razed.
      if (city.hp <= 0) {
        let captor = -1;
        let best = 0;
        for (let k = 0; k < N; k++) {
          if (k !== city.civ && city.siegeBy[k] > best) { best = city.siegeBy[k]; captor = k; }
        }
        if (captor >= 0 && rng() > RAZE_CHANCE) {
          log(`🚩 ¡${t.civs[captor].name} le arrebató ${city.name} (${city.muni}) a ${c.name}!`, captor);
          city.civ = captor;
          city.hp = city.maxHp * 0.5;
          city.pop = Math.max(3, city.pop * 0.5);
          city.loyalty = 55;
          city.flash = 45; // destello al cambiar de color
          t.owner[idx(city.x, city.y)] = captor;
        } else {
          log(`💥 ¡${city.name} (${city.muni}) de ${c.name} fue saqueada y arrasada!`, city.civ);
          t.owner[idx(city.x, city.y)] = -1;
          t.cities.splice(i, 1);
          continue;
        }
      }
      city.besieged = false;
      city.siegeBy.fill(0);
      if (city.flash > 0) city.flash--;
      updateLoyalty(city);
    }
  }

  function updateLoyalty(city) {
    // Loyalty erodes when surrounded by enemy-owned land.
    let enemyAround = 0;
    let total = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = city.x + dx;
        const ny = city.y + dy;
        if (!inBounds(nx, ny) || isOcean(t.tiles[idx(nx, ny)])) continue;
        total++;
        const o = t.owner[idx(nx, ny)];
        if (o >= 0 && o !== city.civ) enemyAround++;
      }
    }
    const pressure = total ? enemyAround / total : 0;
    city.loyalty += pressure > 0.5 ? -0.6 : 0.3;
    city.loyalty = Math.max(0, Math.min(100, city.loyalty));
    if (city.loyalty <= 0 && rng() < 0.05) {
      // Rebellion: flip to the dominant surrounding civ (or independence).
      const flipTo = dominantNeighborCiv(city) ?? CIV_INDEX.ind;
      if (flipTo !== city.civ) {
        const oldName = t.civs[city.civ].name;
        city.civ = flipTo;
        city.loyalty = 60;
        log(`🔥 ¡${city.name} se rebela y abandona a ${oldName} por ${t.civs[flipTo].name}!`, flipTo);
      }
    }
  }

  function dominantNeighborCiv(city) {
    const tally = new Array(N).fill(0);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = city.x + dx;
        const ny = city.y + dy;
        if (!inBounds(nx, ny)) continue;
        const o = t.owner[idx(nx, ny)];
        if (o >= 0 && o !== city.civ) tally[o]++;
      }
    }
    let best = -1;
    let bestN = 0;
    for (let i = 0; i < N; i++) if (tally[i] > bestN) { bestN = tally[i]; best = i; }
    return best >= 0 ? best : null;
  }

  // ---- Territory & stats ------------------------------------------------
  function recomputeTerritory() {
    // City influence sets the bulk of ownership; unit paint adds frontiers.
    t.owner.fill(-1);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const ti = idx(x, y);
        if (isOcean(t.tiles[ti])) continue;
        let bestCiv = -1;
        let bestInf = 0.18; // threshold
        for (const city of t.cities) {
          const dx = city.x - x;
          const dy = city.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const strength = 2 + city.pop * 0.5;
          const inf = strength / (1 + dist * dist * 0.12);
          if (inf > bestInf) { bestInf = inf; bestCiv = city.civ; }
        }
        if (bestCiv >= 0) t.owner[ti] = bestCiv;
      }
    }
    // Units paint the ground they stand on (carries the frontier).
    for (const u of t.units) t.owner[idx(u.x, u.y)] = u.civ;
  }

  function recomputeStats() {
    for (let i = 0; i < N; i++) {
      t.stats[i].units = 0;
      t.stats[i].cities = 0;
      t.stats[i].territory = 0;
      t.stats[i].pop = 0;
    }
    for (const u of t.units) t.stats[u.civ].units++;
    for (const c of t.cities) {
      t.stats[c.civ].cities++;
      t.stats[c.civ].pop += c.pop;
    }
    for (let i = 0; i < t.owner.length; i++) {
      const o = t.owner[i];
      if (o >= 0) t.stats[o].territory++;
    }
    for (let i = 0; i < N; i++) t.stats[i].pop = Math.round(t.stats[i].pop + t.stats[i].units);

    // Momentum: rank the living civs by territory; the leader fights and grows
    // harder, last place weaker. This "rich get richer" pressure reliably
    // breaks the symmetric three-way stalemate and drives games to a winner,
    // while the leader (and thus the eventual victor) is decided by who got
    // ahead — which is driven by their traits.
    const alive = [];
    for (let i = 0; i < N; i++) if (t.stats[i].cities > 0 || t.stats[i].units > 0) alive.push(i);
    for (let i = 0; i < N; i++) t.momentum[i] = 1;
    alive.sort((a, b) => t.stats[b].territory - t.stats[a].territory);
    alive.forEach((ci, rank) => { t.momentum[ci] = Math.max(0.7, 1.32 - rank * 0.22); });
  }

  // ---- Diplomacy --------------------------------------------------------
  function updateDiplomacy() {
    for (let i = 0; i < N; i++) {
      const ci = t.civs[i];
      for (let j = i + 1; j < N; j++) {
        // Drift toward neutral, modulated by personalities. Aggression
        // pushes neighbors to war faster than diplomacy can patch things up.
        let drift = (50 - t.rel[i][j]) * 0.002;
        drift += (ci.traits.diplomacy + t.civs[j].traits.diplomacy) * 0.0012;
        drift -= (ci.traits.aggression + t.civs[j].traits.aggression) * 0.004;
        adjustRel(i, j, drift);

        const atWar = t.war[i][j];
        if (!atWar && t.rel[i][j] < WAR_THRESHOLD) {
          // Smart civs avoid a second front; the PNP never learns.
          const reckless = ci.traits.aggression > 7 || t.civs[j].traits.aggression > 7;
          const busy = anyWar(i) || anyWar(j);
          if (reckless || !busy || rng() < 0.2) {
            t.war[i][j] = t.war[j][i] = true;
            const aggressor = ci.traits.aggression >= t.civs[j].traits.aggression ? i : j;
            const other = aggressor === i ? j : i;
            const reasons = [
              'por tierras en disputa',
              'tras un amargo plebiscito de estatus',
              'en un choque de ideologías',
              'por una pugna de corrupción',
              'tras el colapso de las negociaciones',
            ];
            const why = reasons[(rng() * reasons.length) | 0];
            log(`⚔️ ¡${t.civs[aggressor].name} le declara la guerra a ${t.civs[other].name} ${why}!`, aggressor);
          }
        } else if (atWar && t.rel[i][j] > PEACE_THRESHOLD) {
          t.war[i][j] = t.war[j][i] = false;
          log(`🕊️ ${ci.name} y ${t.civs[j].name} deponen las armas y firman una tregua.`);
        }
      }
    }
  }
  function anyWar(i) {
    for (let j = 0; j < N; j++) if (t.war[i][j]) return true;
    return false;
  }

  // ---- Eventos de ambiente (satíricos) ----------------------------------
  function maybeFlavorEvent() {
    if (rng() > 0.018) return;
    const ev = FLAVOR_EVENTS[(rng() * FLAVOR_EVENTS.length) | 0];
    const civIndex = ev.civ === 'any' ? (rng() * N) | 0 : CIV_INDEX[ev.civ];
    const c = t.civs[civIndex];
    if (!c) return;
    log(ev.text.replace('{civ}', c.name), civIndex);
  }

  // ---- La Resistencia: the Independentistas never fully die -------------
  function maybeRevive() {
    const ind = CIV_INDEX.ind;
    if (t.stats[ind].pop > 0 || t.stats[ind].cities > 0) return;
    if (t.tick % 40 !== 0) return;
    if (rng() > 0.45) return;
    // Find a rough tile to hide a guerrilla cell.
    for (let tries = 0; tries < 40; tries++) {
      const x = (rng() * COLS) | 0;
      const y = (rng() * ROWS) | 0;
      if (inBounds(x, y) && isRough(t.tiles[idx(x, y)]) && t.occ[idx(x, y)] === -1) {
        spawnUnit(ind, x, y);
        spawnUnit(ind, x, y);
        t.reviveCount++;
        log('🌿 La Resistencia despierta: guerrilleros independentistas surgen de los montes.', ind);
        return;
      }
    }
  }

  // ---- Wildlife (ambient ecosystem) -------------------------------------
  // type: 0 sheep, 1 wolf, 2 fish, 3 bird
  const ANIMAL = { SHEEP: 0, WOLF: 1, FISH: 2, BIRD: 3 };
  const ANIMAL_CAP = [260, 44, 220, 48];

  function countAnimals(type) {
    let n = 0;
    for (const a of t.animals) if (a.type === type) n++;
    return n;
  }

  function spawnAnimal(type, x, y) {
    if (countAnimals(type) >= ANIMAL_CAP[type]) return null;
    if (!inBounds(x, y)) return null;
    const wantWater = type === ANIMAL.FISH;
    const onWater = isOcean(t.tiles[idx(x, y)]);
    if (type !== ANIMAL.BIRD && wantWater !== onWater) {
      // nudge to a suitable nearby tile
      const spot = wantWater ? nearestWater(x, y) : nearestLandFree(x, y);
      if (!spot) return null;
      x = spot.x; y = spot.y;
    }
    const a = {
      id: t.nextAnimalId++,
      type,
      x, y,
      hp: type === ANIMAL.WOLF ? 8 : 4,
      food: 6,
      age: 0,
      maxAge: 500 + ((rng() * 400) | 0),
    };
    t.animals.push(a);
    return a;
  }
  world.spawnAnimal = spawnAnimal;
  world.ANIMAL = ANIMAL;

  function nearestWater(x, y) {
    for (let r = 1; r < 24; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && isOcean(t.tiles[idx(nx, ny)])) return { x: nx, y: ny };
      }
    }
    return null;
  }
  function nearestLandFree(x, y) {
    for (let r = 0; r < 24; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && isLand(t.tiles[idx(nx, ny)])) return { x: nx, y: ny };
      }
    }
    return null;
  }

  function seedAnimals() {
    for (let i = 0; i < 90; i++) {
      const x = (rng() * COLS) | 0, y = (rng() * ROWS) | 0;
      if (isLand(t.tiles[idx(x, y)])) spawnAnimal(ANIMAL.SHEEP, x, y);
    }
    for (let i = 0; i < 14; i++) {
      const x = (rng() * COLS) | 0, y = (rng() * ROWS) | 0;
      if (isLand(t.tiles[idx(x, y)])) spawnAnimal(ANIMAL.WOLF, x, y);
    }
    for (let i = 0; i < 120; i++) {
      const x = (rng() * COLS) | 0, y = (rng() * ROWS) | 0;
      if (isOcean(t.tiles[idx(x, y)])) spawnAnimal(ANIMAL.FISH, x, y);
    }
    for (let i = 0; i < 20; i++) spawnAnimal(ANIMAL.BIRD, (rng() * COLS) | 0, (rng() * ROWS) | 0);
  }

  function wanderStep(a, preferWater) {
    // pick a random adjacent tile of the right element
    const dx = ((rng() * 3) | 0) - 1;
    const dy = ((rng() * 3) | 0) - 1;
    const nx = a.x + dx, ny = a.y + dy;
    if (!inBounds(nx, ny)) return;
    const ocean = isOcean(t.tiles[idx(nx, ny)]);
    if (a.type === ANIMAL.BIRD || ocean === preferWater) { a.x = nx; a.y = ny; }
  }

  function updateAnimals() {
    const dead = [];
    for (let i = 0; i < t.animals.length; i++) {
      const a = t.animals[i];
      a.age++;
      if (a.age > a.maxAge || a.hp <= 0) { dead.push(i); continue; }
      // movement (throttled per animal)
      if ((t.tick + a.id) % 2 === 0) {
        if (a.type === ANIMAL.WOLF) {
          const prey = nearestSheep(a, 6);
          if (prey) {
            a.x += Math.sign(prey.x - a.x);
            a.y += Math.sign(prey.y - a.y);
            if (Math.abs(prey.x - a.x) <= 1 && Math.abs(prey.y - a.y) <= 1) {
              prey.hp = 0; a.food = Math.min(14, a.food + 6);
            }
          } else wanderStep(a, false);
        } else {
          wanderStep(a, a.type === ANIMAL.FISH);
        }
      }
      // hunger / breeding (cheap, occasional)
      if ((t.tick + a.id) % 24 === 0) {
        a.food -= 1;
        if (a.food <= 0) { dead.push(i); continue; }
        const breeds = a.type === ANIMAL.SHEEP || a.type === ANIMAL.FISH
          ? a.food > 4 && rng() < 0.25
          : a.food > 9 && rng() < 0.2;
        if (breeds) { a.food -= 3; spawnAnimal(a.type, a.x, a.y); }
        if (a.type === ANIMAL.SHEEP && isLand(t.tiles[idx(a.x, a.y)])) a.food = Math.min(8, a.food + 2);
      }
    }
    if (dead.length) {
      const set = new Set(dead);
      t.animals = t.animals.filter((_, i) => !set.has(i));
    }
  }

  function nearestSheep(a, r) {
    let best = null, bd = r * r + 1;
    for (const s of t.animals) {
      if (s.type !== ANIMAL.SHEEP || s.hp <= 0) continue;
      const d = (s.x - a.x) ** 2 + (s.y - a.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---- Transient effects (god-power toys) -------------------------------
  // kind: 'dragon' | 'ufo' | 'tornado' | 'volcano'
  function addEffect(e) { t.effects.push(e); }

  world.spawnDragon = function (x, y) {
    addEffect({ kind: 'dragon', x: 0, y: Math.max(0, y - 10), tx: x, ty: y, ttl: 150, t: 0 });
    log('🐉 ¡Un dragón desciende sobre la isla!');
  };
  world.spawnUfo = function (x, y) {
    addEffect({ kind: 'ufo', x, y, ttl: 150, t: 0 });
    log('🛸 ¡Aparece un OVNI y se lleva gente con su rayo!');
  };
  world.spawnTornado = function (x, y) {
    addEffect({ kind: 'tornado', x, y, vx: (rng() - 0.5) * 1.4, vy: (rng() - 0.5) * 1.4, ttl: 240, t: 0 });
    log('🌪️ ¡Un tornado arrasa la tierra!');
  };
  world.eruptVolcano = function (x, y) {
    world.terraform(x, y, 1, TILE.MOUNTAIN);
    addEffect({ kind: 'volcano', x, y, ttl: 120, t: 0 });
    log('🌋 ¡Un volcán entra en erupción y escupe lava!');
  };

  function cullAt(cx, cy, r) {
    // remove animals within radius (used by disasters / effects)
    if (!t.animals.length) return;
    t.animals = t.animals.filter((a) => Math.hypot(a.x - cx, a.y - cy) > r);
  }
  world._cullAnimals = cullAt;

  function abductNear(cx, cy, r) {
    // remove one nearby unit or animal
    for (let ai = 0; ai < t.units.length; ai++) {
      const u = t.units[ai];
      if (u && !deadUnits.has(ai) && Math.hypot(u.x - cx, u.y - cy) <= r) { killUnit(ai); return true; }
    }
    for (let i = 0; i < t.animals.length; i++) {
      if (Math.hypot(t.animals[i].x - cx, t.animals[i].y - cy) <= r) {
        t.animals.splice(i, 1); return true;
      }
    }
    return false;
  }

  function updateEffects() {
    let dirty = false;
    for (let i = t.effects.length - 1; i >= 0; i--) {
      const e = t.effects[i];
      e.t++;
      e.ttl--;
      if (e.kind === 'dragon') {
        // fly toward target, then circle and breathe fire
        const ang = e.t * 0.18;
        const dxx = e.tx + Math.cos(ang) * 6 - e.x;
        const dyy = e.ty + Math.sin(ang) * 6 - e.y;
        e.x += dxx * 0.12; e.y += dyy * 0.12;
        if (e.t % 3 === 0) hitArea(e.x, e.y, 2.4, 6);
      } else if (e.kind === 'ufo') {
        e.x += Math.sin(e.t * 0.08) * 0.6;
        if (e.t % 6 === 0) abductNear(e.x, e.y, 3);
      } else if (e.kind === 'tornado') {
        e.x += e.vx; e.y += e.vy;
        if (e.x < 2 || e.x > COLS - 2) e.vx *= -1;
        if (e.y < 2 || e.y > ROWS - 2) e.vy *= -1;
        e.vx += (rng() - 0.5) * 0.3; e.vy += (rng() - 0.5) * 0.3;
        e.vx = Math.max(-1.6, Math.min(1.6, e.vx));
        e.vy = Math.max(-1.6, Math.min(1.6, e.vy));
        if (e.t % 2 === 0) hitArea(e.x, e.y, 2.0, 5);
      } else if (e.kind === 'volcano') {
        const r = 1 + e.t * 0.05;
        if (e.t % 4 === 0) { hitArea(e.x, e.y, Math.min(6, r), 7); dirty = true; }
      }
      if (e.ttl <= 0) t.effects.splice(i, 1);
    }
    if (dirty) { recomputeTerritory(); recomputeStats(); }
  }

  // damage units, cities and animals in a small area (used by live effects)
  function hitArea(cx, cy, r, dmg) {
    for (let ai = 0; ai < t.units.length; ai++) {
      const u = t.units[ai];
      if (!u || deadUnits.has(ai)) continue;
      if (Math.hypot(u.x - cx, u.y - cy) <= r) { u.hp -= dmg; if (u.hp <= 0) killUnit(ai); }
    }
    for (const city of t.cities) if (Math.hypot(city.x - cx, city.y - cy) <= r) city.hp -= dmg * 0.6;
    cullAt(cx, cy, r);
    compactUnits();
  }

  // ---- Líderes y sucesión -----------------------------------------------
  // El líder es la figura real del partido (nombre fijo). Si cae, otro toma
  // el mando pero el partido mantiene a su figura al frente.
  function promoteLeader(civIndex, announce) {
    let best = null;
    for (const u of t.units) {
      if (u.civ !== civIndex || u.dead) continue;
      if (!best || u.kills > best.kills || (u.kills === best.kills && u.age > best.age)) best = u;
    }
    t.leaders[civIndex] = best;
    if (!best) return null;
    const c = t.civs[civIndex];
    best.isLeader = true;
    best.rulerName = c.leader;
    best.title = c.title || 'Líder';
    best.since = t.tick;
    best.maxHp += 26;
    best.hp = best.maxHp;
    if (announce) log(`👑 ${best.rulerName} encabeza a ${c.name} como ${best.title}.`, civIndex);
    return best;
  }

  function checkSuccession() {
    for (let i = 0; i < N; i++) {
      const lead = t.leaders[i];
      if (!lead || lead.dead) {
        const had = !!lead;
        const next = promoteLeader(i, false);
        const c = t.civs[i];
        if (next && had && rng() < 0.5) {
          log(`⚰️ Cae ${c.leader} de ${c.name}; otro toma el mando.`, i);
        } else if (!next) {
          t.leaders[i] = null;
        }
      }
    }
  }

  // Find the unit on/near a tile (for click-to-inspect).
  world.unitAt = function (x, y) {
    for (let r = 0; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const oi = t.occ[idx(nx, ny)];
          if (oi >= 0 && t.units[oi] && !t.units[oi].dead) return t.units[oi];
        }
      }
    }
    return null;
  };
  world.cityAtTile = function (x, y) { return cityAt(x, y); };

  // ---- Win check --------------------------------------------------------
  function checkWinner() {
    const alive = [];
    for (let i = 0; i < N; i++) {
      if (t.stats[i].cities > 0 || t.stats[i].units > 0) alive.push(i);
    }
    if (alive.length === 1) {
      t.winner = alive[0];
      log(`👑 ¡${t.civs[alive[0]].name} se queda solo y gobierna Puerto Rico!`, alive[0]);
      return;
    }
    for (let i = 0; i < N; i++) {
      if (t.landCount && t.stats[i].territory / t.landCount >= DOMINANCE) {
        t.winner = i;
        log(`👑 ¡${t.civs[i].name} domina la isla y reclama la victoria!`, i);
        return;
      }
    }
  }

  // ---- Periodic "State of the Island" summary ---------------------------
  function shortName(i) { return t.civs[i].name.replace('Los ', ''); }
  function summarize() {
    const land = t.landCount || 1;
    let leader = 0;
    for (let i = 1; i < N; i++) if (t.stats[i].territory > t.stats[leader].territory) leader = i;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const pct = Math.round((t.stats[i].territory / land) * 100);
      const pop = t.stats[i].pop >= 1000 ? (t.stats[i].pop / 1000).toFixed(1) + 'k' : t.stats[i].pop;
      parts.push(`${shortName(i)} ${pop}·${t.stats[i].cities}c·${pct}%`);
    }
    const wars = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      if (t.war[i][j]) wars.push(`${shortName(i)}–${shortName(j)}`);
    }
    const warTxt = wars.length ? ` · en guerra: ${wars.join(', ')}` : ' · paz tensa';
    const ldPct = Math.round((t.stats[leader].territory / land) * 100);
    log(`📊 Estado de la Isla — ${shortName(leader)} domina (${ldPct}%). ${parts.join(' · ')}${warTxt}.`, leader);
  }

  // ---- Main tick --------------------------------------------------------
  function step() {
    if (t.winner !== null) return;
    t.tick++;
    for (let ai = 0; ai < t.units.length; ai++) {
      if (deadUnits.has(ai)) continue;
      updateUnit(t.units[ai], ai);
    }
    compactUnits();
    checkSuccession();
    updateCities();
    updateAnimals();
    updateFree();
    updateEffects();
    updateDiplomacy();
    maybeFlavorEvent();
    maybeRevive();
    if (t.tick % TERRITORY_EVERY === 0) {
      recomputeTerritory();
      recomputeStats();
      checkWinner();
    }
    if (t.tick % 10 === 0) updateEconomy();
    if (t.tick % 120 === 0) {
      t.history.push({
        pop: t.stats.map((s) => s.pop),
        terr: t.stats.map((s) => s.territory),
        budget: t.budget.map((b) => Math.round(b)),
        free: t.free.length,
      });
      if (t.history.length > 180) t.history.shift();
    }
    if (t.tick % SUMMARY_EVERY === 0 && t.winner === null) summarize();
  }
  world.step = step;

  // ---- Power hooks (called by powers.js) --------------------------------
  world.damageArea = function (cx, cy, r, dmg, label, killTerrain = false) {
    let casualties = 0;
    for (let ai = 0; ai < t.units.length; ai++) {
      const u = t.units[ai];
      if (!u || deadUnits.has(ai)) continue;
      const d = Math.hypot(u.x - cx, u.y - cy);
      if (d <= r) {
        u.hp -= dmg * (1 - d / (r + 1));
        if (u.hp <= 0) { killUnit(ai); casualties++; }
      }
    }
    for (const city of t.cities) {
      if (Math.hypot(city.x - cx, city.y - cy) <= r) city.hp -= dmg * 1.2;
    }
    if (killTerrain) {
      for (let y = (cy - r) | 0; y <= cy + r; y++) {
        for (let x = (cx - r) | 0; x <= cx + r; x++) {
          if (inBounds(x, y) && Math.hypot(x - cx, y - cy) <= r * 0.5 && isLand(t.tiles[idx(x, y)])) {
            // scorch heavy hits into beach/grass scars near the center
            if (rng() < 0.3) t.tiles[idx(x, y)] = TILE.BEACH;
          }
        }
      }
    }
    cullAt(cx, cy, r);
    cullFree(cx, cy, r);
    compactUnits();
    if (label) log(label + (casualties ? ` (${casualties} bajas)` : ''));
    recomputeTerritory();
    recomputeStats();
    checkWinner();
  };

  world.terraform = function (cx, cy, r, tile) {
    for (let y = (cy - r) | 0; y <= cy + r; y++) {
      for (let x = (cx - r) | 0; x <= cx + r; x++) {
        if (!inBounds(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > r) continue;
        if (tile === TILE.OCEAN) {
          // Drown any unit there.
          const oi = t.occ[idx(x, y)];
          if (oi >= 0) killUnit(oi);
        }
        t.tiles[idx(x, y)] = tile;
      }
    }
    compactUnits();
    recomputeTerritory();
    recomputeStats();
  };

  world.blessCiv = function (civIndex) {
    for (const u of t.units) if (u.civ === civIndex) u.hp = u.maxHp;
    for (const c of t.cities) if (c.civ === civIndex) { c.hp = c.maxHp; c.pop = Math.min(45, c.pop + 8); }
    for (let j = 0; j < N; j++) if (j !== civIndex) adjustRel(civIndex, j, 4);
    log(`✨ Una bendición divina fortalece a ${t.civs[civIndex].name}.`, civIndex);
  };

  world.blackout = function (cx, cy, r) {
    let hit = 0;
    for (const c of t.cities) {
      if (Math.hypot(c.x - cx, c.y - cy) <= r) { c.pop = Math.max(1, c.pop - 6); hit++; }
    }
    log(`🔌 ¡Apagón! LUMA deja ${hit} pueblo(s) a oscuras.`);
  };

  world.reset = function () { /* recreated externally */ };

  seed();
  return world;
}
