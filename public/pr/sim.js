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
  municipioAt, MUNI_NAMES,
} from './map.js';
import { CITY_NAMES, FLAVOR_EVENTS, CIV_INDEX } from './civs.js';

// --- Tunables (scaled for the larger real-coastline map ~17.5k land tiles) --
const MAX_UNITS = 2200;
const MAX_CITIES = 44;
const MIN_CITY_DIST = 12;
const UNIT_SPEED = 0.7;
const RETARGET_EVERY = 12;
const TERRITORY_EVERY = 6;
const WAR_THRESHOLD = 32;
const PEACE_THRESHOLD = 62;
const DOMINANCE = 0.48; // fraction of land owned to win
const EVENT_CAP = 160;
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
    winner: null,
    landCount: 0,
    nextUnitId: 1,
    nextCityId: 1,
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

  function spawnUnit(civIndex, x, y) {
    if (t.units.length >= MAX_UNITS) return null;
    const spot = inBounds(x, y) && isLand(t.tiles[idx(x, y)]) && t.occ[idx(x, y)] === -1
      ? { x, y }
      : freeNeighbor(x, y) || nearestFree(x, y);
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
      siegeBy: new Array(N).fill(0),
    };
    t.cities.push(city);
    return city;
  }
  world.foundCity = foundCity;

  // ---- Seed the world (balanced start) ----------------------------------
  function seed() {
    for (let i = 0; i < N; i++) {
      const s = starts[i % starts.length];
      const city = foundCity(i, s.x, s.y, 8);
      if (city) log(`🏙️ ${t.civs[i].name} found their capital ${city.name} in ${city.muni}.`, i);
      for (let k = 0; k < 6; k++) spawnUnit(i, s.x, s.y);
    }
    recomputeTerritory();
    recomputeStats();
  }

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
  function retarget(unit) {
    const c = t.civs[unit.civ];
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
      if (isOcean(tile)) continue;
      const score = hasTarget
        ? (nx - unit.tx) ** 2 + (ny - unit.ty) ** 2 + rng() * 0.3
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
      t.owner[ni] = unit.civ;
      maybeFoundCity(unit);
    } else {
      const other = t.units[occupant];
      if (other && other.civ !== unit.civ && t.war[unit.civ][other.civ]) {
        fight(unit, other);
        if (other.hp <= 0) killUnit(occupant);
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
    if (city) log(`🏘️ ${c.name} settle ${city.name} in ${city.muni}.`, unit.civ);
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
      // Spawn a citizen when ripe.
      if (city.pop >= 7 && t.units.length < MAX_UNITS) {
        const spot = freeNeighbor(city.x, city.y);
        if (spot) {
          spawnUnit(city.civ, spot.x, spot.y);
          city.pop -= 4;
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
          log(`🚩 ${t.civs[captor].name} captured ${city.name} (${city.muni}) from ${c.name}!`, captor);
          city.civ = captor;
          city.hp = city.maxHp * 0.5;
          city.pop = Math.max(3, city.pop * 0.5);
          city.loyalty = 55;
          t.owner[idx(city.x, city.y)] = captor;
        } else {
          log(`💥 ${c.name}'s city of ${city.name} (${city.muni}) was sacked and burned!`, city.civ);
          t.owner[idx(city.x, city.y)] = -1;
          t.cities.splice(i, 1);
          continue;
        }
      }
      city.besieged = false;
      city.siegeBy.fill(0);
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
        log(`🔥 ${city.name} rebels, abandoning ${oldName} for ${t.civs[flipTo].name}!`, flipTo);
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
    alive.forEach((ci, rank) => { t.momentum[ci] = Math.max(0.6, 1.8 - rank * 0.55); });
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
              'over disputed borderlands',
              'after a bitter status referendum',
              'in a clash of ideologies',
              'over a corruption feud',
              'after talks collapsed',
            ];
            const why = reasons[(rng() * reasons.length) | 0];
            log(`⚔️ ${t.civs[aggressor].name} declare war on ${t.civs[other].name} ${why}!`, aggressor);
          }
        } else if (atWar && t.rel[i][j] > PEACE_THRESHOLD) {
          t.war[i][j] = t.war[j][i] = false;
          log(`🕊️ ${ci.name} and ${t.civs[j].name} lay down arms and sign a truce.`);
        }
      }
    }
  }
  function anyWar(i) {
    for (let j = 0; j < N; j++) if (t.war[i][j]) return true;
    return false;
  }

  // ---- Random flavor events --------------------------------------------
  function maybeFlavorEvent() {
    if (rng() > 0.018) return;
    const ev = FLAVOR_EVENTS[(rng() * FLAVOR_EVENTS.length) | 0];
    let civIndex;
    if (ev.civ === 'any') civIndex = (rng() * N) | 0;
    else civIndex = CIV_INDEX[ev.civ];
    const c = t.civs[civIndex];
    if (!c) return;
    // Apply a small temporary nudge to a trait.
    const delta = ev.kind === 'buff' ? 1 : -1;
    const cur = c.traits[ev.stat];
    c.traits[ev.stat] = Math.max(0, Math.min(10, cur + delta * 0.0)); // flavor only, keep balanced
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
        log('🌿 La Resistencia stirs: Independentista guerrillas emerge from the hills.', ind);
        return;
      }
    }
  }

  // ---- Win check --------------------------------------------------------
  function checkWinner() {
    const alive = [];
    for (let i = 0; i < N; i++) {
      if (t.stats[i].cities > 0 || t.stats[i].units > 0) alive.push(i);
    }
    if (alive.length === 1) {
      t.winner = alive[0];
      log(`👑 ${t.civs[alive[0]].name} stand alone — they rule Puerto Rico!`, alive[0]);
      return;
    }
    for (let i = 0; i < N; i++) {
      if (t.landCount && t.stats[i].territory / t.landCount >= DOMINANCE) {
        t.winner = i;
        log(`👑 ${t.civs[i].name} dominate the island and claim victory!`, i);
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
    const warTxt = wars.length ? ` · at war: ${wars.join(', ')}` : ' · uneasy peace';
    const ldPct = Math.round((t.stats[leader].territory / land) * 100);
    log(`📊 Estado de la Isla — ${shortName(leader)} lead (${ldPct}%). ${parts.join(' · ')}${warTxt}.`, leader);
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
    updateCities();
    updateDiplomacy();
    maybeFlavorEvent();
    maybeRevive();
    if (t.tick % TERRITORY_EVERY === 0) {
      recomputeTerritory();
      recomputeStats();
      checkWinner();
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
    compactUnits();
    if (label) log(label + (casualties ? ` (${casualties} dead)` : ''));
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
    log(`✨ A divine blessing strengthens ${t.civs[civIndex].name}.`, civIndex);
  };

  world.blackout = function (cx, cy, r) {
    let hit = 0;
    for (const c of t.cities) {
      if (Math.hypot(c.x - cx, c.y - cy) <= r) { c.pop = Math.max(1, c.pop - 6); hit++; }
    }
    log(`🔌 Blackout! LUMA plunges ${hit} town(s) into darkness.`);
  };

  world.reset = function () { /* recreated externally */ };

  seed();
  return world;
}
