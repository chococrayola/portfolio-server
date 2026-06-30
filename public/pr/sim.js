/* sim.js — the simulation engine (city-network redesign, no combat).
 *
 * Puerto Rico's 78 municipios are fixed cities. Each starts neutral and is
 * seeded with free-thinkers (indecisos). A single population of CITIZENS lives
 * on the island: they age (slowly), move (less as they get older), reproduce,
 * and — once adult — either affiliate to a party or stay free-thinkers forever.
 *
 * A city is owned by whichever party most of its citizens belong to. Money
 * (a party's treasury = the sum of its cities' worth) funds campaigns that make
 * nearby free-thinkers affiliate faster, so the richer party spreads quicker.
 * There is NO combat: no fighting, no war, no kills. Citizens die only of old
 * age (or by an act of god from the powers panel).
 *
 * render.js reads the public arrays (citizens, cities) and powers.js calls the
 * mutator hooks (spawnUnit/spawnFree/damageArea/…).
 */

import {
  COLS, ROWS, TILE, idx, inBounds, isLand,
  MUNI_NAMES, MUNI_CENTROIDS, nearestLand,
} from './map.js?v=39';
import { FLAVOR_EVENTS, CIV_INDEX, CITIZEN_NAMES, PROFESSIONS } from './civs.js?v=39';
import { MUNI_POP, PEOPLE_PER_CITIZEN } from './popdata.js?v=39';
import { dateToTick, TIMELINE, RANDOM_EVENTS } from './timeline.js?v=39';

// --- Tunables (1 tick = 1 DAY; 30-day months, 360-day years) --------------
const MAX_CITIZENS = 3000;
const YEAR_DAYS = 360;
const MOVE_BASE = 0.5;       // base move propensity per tick
const AFFIL_EVERY = 60;      // days between affiliation checks per citizen
const BIRTH_EVERY = 720;     // days between birth checks per adult (~2 yr)
const BIRTH_RATE = 0.55;     // chance a birth check produces a child
const MIGRATE_EVERY = 200;   // days between migration checks
const OWNER_EVERY = 20;      // recompute city ownership cadence (days)
const ECON_EVERY = 20;       // recompute economy cadence (days)
const EVENT_CAP = 320;
const SUMMARY_EVERY = 720;   // "estado de la isla" once a year-ish
const SEED_FILL = 0.55;      // start cities at ~55% of capacity
const HOME_MEMBERS_FRAC = 0.25; // fraction of a home city seeded as party members
const WORTH_K = 70;          // city worth per resident citizen
const OWNER_INF = 3.0;       // influence of a city's current owner
const PRESENCE_INF = 0.22;   // influence per affiliated citizen present
const NEIGHBOR_INF = 0.9;    // influence a neighboring owned city projects
const JOIN_K = 0.05;         // affiliation probability scaler
// Currency
const BASE_WAGE = 16;        // personal income per econ tick at avg prosperity
const LEADER_SALARY = 120;   // extra leader pay per econ tick (× budgetFactor)

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

// ADN político inicial de cada partido, derivado de sus rasgos, con un refuerzo
// de "firma" en su eje dominante para que los cinco líderes empiecen con
// posturas distintas (Expansionista / Movilizador / Tecnócrata / Austero / Populista).
function seedPolicy(civ) {
  const tr = (civ && civ.traits) || {};
  const n = (v, d) => (typeof v === 'number' ? v : d) / 10;
  const pol = {
    expansion: n(tr.expansion, 5),
    economy: n(tr.intelligence, 5),
    welfare: n(tr.diplomacy, 5),
    campaign: n(tr.growth, 5),
    austerity: n(tr.resilience, 4),
  };
  // Refuerza un eje de "firma" por partido para que los cinco arranquen con
  // posturas distintas; luego runLeaderAI las adapta según el juego.
  const SIG = { pnp: 'expansion', ppd: 'campaign', mvc: 'economy', ind: 'austerity', molina: 'welfare' };
  const sig = SIG[civ && civ.id];
  if (sig) pol[sig] = Math.min(1, Math.max(pol[sig], 0.55) + 0.25);
  return pol;
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
    citizens: [],
    cities: [],
    stats: civs.map(() => ({ pop: 0, units: 0, cities: 0, territory: 0 })),
    leaders: civs.map(() => null),
    deputy: civs.map(() => null),
    recruited: civs.map(() => 0),      // cumulative affiliations gained
    budget: civs.map(() => 0),         // treasury = sum of owned city worth
    budgetFactor: civs.map(() => 1),   // campaign strength from money
    policy: civs.map((c) => seedPolicy(c)),       // ADN político derivado de los rasgos
    stance: civs.map(() => 'Tecnócrata'),         // etiqueta legible de la política del líder
    cityHistory: [],                   // [cityId] = [{t,pop,worth,owner}]
    leaderHistory: civs.map(() => []), // [p] = [{t,treasury,cities,balance,stance}]
    aiPrevCities: civs.map(() => 0),
    deputyLog: civs.map(() => []),
    successionLog: civs.map(() => []),
    history: [],
    freeCount: 0,
    landCount: 0,           // = number of cities (denominator for territory %)
    timelineIdx: 0,         // next scripted history event to fire
    nextId: 1,
  };
  const t = world;

  const tileAt = (x, y) => t.tiles[idx(x, y)];
  function log(text, civIndex = null, tag = null) {
    t.events = t.events || [];
    t.events.unshift({ tick: t.tick, text, civ: civIndex, tag });
    if (t.events.length > EVENT_CAP) t.events.pop();
  }
  t.events = [];
  world.log = log;

  // Charisma: appeal to free-thinkers (brutality repels, diplomacy/intellect draw).
  world.charisma = civs.map((c) => Math.max(0.3,
    c.traits.diplomacy + 0.5 * c.traits.intelligence - 0.4 * c.traits.brutality +
    (c.specials && c.specials.recruiter ? 2 : 0)));
  const maxCharisma = Math.max(...world.charisma);

  // ---- Geometry helpers -------------------------------------------------
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
  function nearestCity(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.cities.length; i++) {
      const c = t.cities[i];
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---- Cities (one per municipio, fixed) --------------------------------
  const TERR_WORTH = {
    [TILE.URBAN]: 1.9, [TILE.BEACH]: 1.2, [TILE.GRASS]: 1.0,
    [TILE.FOREST]: 0.85, [TILE.HILL]: 0.8, [TILE.MOUNTAIN]: 0.6,
  };
  function cityBaseWorth(x, y) {
    const m = TERR_WORTH[tileAt(x, y)] || 1;
    return Math.round((500 + rng() * 700) * m);
  }
  function pickCitizen() { return CITIZEN_NAMES[(rng() * CITIZEN_NAMES.length) | 0]; }
  function pickProfession() { return PROFESSIONS[(rng() * PROFESSIONS.length) | 0]; }

  let cityNeighbors = []; // indices of the few nearest cities, per city

  function seedCities() {
    for (let i = 0; i < MUNI_NAMES.length; i++) {
      const ctr = MUNI_CENTROIDS[i];
      if (!ctr) continue;
      const spot = nearestLand(t.tiles, ctr[0], ctr[1]);
      const name = MUNI_NAMES[i];
      // Capacity from the real 2020 census population (San Juan ≈ 214, Culebra ≈ 4).
      const realPop = MUNI_POP[name] || 12000;
      const capacity = Math.max(4, Math.round(realPop / PEOPLE_PER_CITIZEN));
      t.cities.push({
        id: t.cities.length + 1,
        x: spot.x, y: spot.y,
        muni: name, name,
        owner: -1,                 // neutral
        capacity,                  // máx. ciudadanos (según población real)
        realPop,                   // población real 2020 (referencia)
        base: cityBaseWorth(spot.x, spot.y),
        worth: 0,
        pop: 0,                    // total citizens homed here
        tally: new Array(N).fill(0),
        campaign: new Array(N).fill(0), // empuje de campaña por partido (decae)
        free: 0,
        flash: 0,
        alcalde: '—',       // nombre del/de la alcalde/sa (de alcaldeRef)
        alcaldeRef: null,   // ciudadano/a real que ejerce de alcalde/sa
        alcaldeSince: 0,
      });
    }
    t.landCount = t.cities.length;
    t.cityHistory = t.cities.map(() => []);
    // nearest-neighbor table (for migration + influence spread)
    cityNeighbors = t.cities.map((c, i) => {
      const ds = t.cities.map((o, j) => ({ j, d: (o.x - c.x) ** 2 + (o.y - c.y) ** 2 }))
        .filter((e) => e.j !== i).sort((a, b) => a.d - b.d);
      return ds.slice(0, 4).map((e) => e.j);
    });
  }

  // ---- Citizens ---------------------------------------------------------
  function makeCitizen(party, x, y) {
    const here = inBounds(x, y) && isLand(t.tiles[idx(x, y)]);
    const spot = here ? { x, y } : (nearestLandFree(x, y) || { x, y });
    return {
      id: t.nextId++,
      x: spot.x, y: spot.y,
      party,                              // -1 = free-thinker
      age: 0,                             // edad en días (1 tick = 1 día)
      maxAge: Math.round((65 + rng() * 35) * YEAR_DAYS), // ~65–100 años
      adultAt: Math.round((16 + rng() * 4) * YEAR_DAYS), // mayoría de edad ~16–20 años
      mobility: Math.pow(rng(), 1.4),     // many low, some high; a few ~never move
      openness: 0.45 + rng() * 0.55,
      committedFree: false,
      name: pickCitizen(),
      profession: pickProfession(),         // oficio al azar (ambientación)
      balance: Math.round(200 + rng() * 1200), // dinero personal ($)
      homeCity: nearestCity(spot.x, spot.y),
      isLeader: false, isDeputy: false, isAlcalde: false, alcaldeOf: null, rulerName: null, title: null,
      since: 0, joined: party >= 0 ? t.tick : null,
      dead: false,
      log: [{ t: t.tick, ev: party >= 0 ? 'Aparece afiliado/a' : 'Aparece (librepensador/a)' }],
    };
  }
  function clog(c, ev) {
    if (!c.log) c.log = [];
    c.log.push({ t: t.tick, ev });
    if (c.log.length > 12) c.log.shift();
  }
  function addCitizen(c) { if (t.citizens.length < MAX_CITIZENS) { t.citizens.push(c); return c; } return null; }

  // Power-panel hooks keep their old names.
  world.spawnUnit = (party, x, y) => addCitizen(makeCitizen(party, x, y));
  world.spawnFree = (x, y) => addCitizen(makeCitizen(-1, x, y));

  function seedCitizens() {
    // Each party gets a home municipio (nearest city to its start anchor).
    const homeOf = new Array(t.cities.length).fill(-1);
    for (let p = 0; p < N; p++) {
      const s = starts[p % starts.length];
      let ci = nearestCity(s.x, s.y);
      // avoid two parties sharing a home
      let guard = 0;
      while (homeOf[ci] >= 0 && guard++ < t.cities.length) ci = (ci + 7) % t.cities.length;
      homeOf[ci] = p;
    }
    // Seed each city to ~55% of its (real-population-based) capacity with
    // free-thinkers; a party's home city also gets a bloc of its members.
    for (let i = 0; i < t.cities.length; i++) {
      const city = t.cities[i];
      const start = Math.max(3, Math.round(city.capacity * SEED_FILL));
      const members = homeOf[i] >= 0 ? Math.round(start * HOME_MEMBERS_FRAC) : 0;
      for (let k = 0; k < start - members; k++) {
        const c = makeCitizen(-1, city.x, city.y);
        c.age = rng() * c.maxAge * 0.7; c.homeCity = i; addCitizen(c);
      }
      for (let k = 0; k < members; k++) {
        const c = makeCitizen(homeOf[i], city.x, city.y);
        c.age = c.adultAt + rng() * 30 * YEAR_DAYS; c.homeCity = i; addCitizen(c);
      }
    }
    recomputeCityOwners(true);
    for (let p = 0; p < N; p++) promoteLeader(p, true);
    recomputeStats();
    recomputeEconomy();
  }

  // ---- Movement / aging / reproduction / affiliation --------------------
  function moveCitizen(c) {
    const slow = Math.max(0.08, 1 - (c.age / c.maxAge) * 0.9); // older → slower
    if ((t.tick + c.id) % MIGRATE_EVERY === 0 && rng() < c.mobility * 0.5) {
      const nbs = cityNeighbors[c.homeCity];
      if (nbs && nbs.length) {
        const target = nbs[(rng() * nbs.length) | 0]; // migrate, carrying affiliation
        if (t.cities[target].pop < t.cities[target].capacity) c.homeCity = target; // sólo si hay cupo
      }
    }
    if (rng() >= c.mobility * slow * MOVE_BASE) return;
    const home = t.cities[c.homeCity];
    let nx = c.x, ny = c.y;
    const far = Math.abs(home.x - c.x) + Math.abs(home.y - c.y);
    if (far > 2 && rng() < 0.7) { nx += Math.sign(home.x - c.x); ny += Math.sign(home.y - c.y); }
    else { nx += ((rng() * 3) | 0) - 1; ny += ((rng() * 3) | 0) - 1; }
    if (inBounds(nx, ny) && isLand(t.tiles[idx(nx, ny)])) { c.x = nx; c.y = ny; }
  }

  function tryAffiliate(c) {
    const city = t.cities[c.homeCity];
    const inf = new Array(N).fill(0);
    if (city.owner >= 0) inf[city.owner] += OWNER_INF * t.budgetFactor[city.owner];
    for (let p = 0; p < N; p++) inf[p] += city.tally[p] * PRESENCE_INF * t.budgetFactor[p];
    for (let p = 0; p < N; p++) inf[p] += (city.campaign[p] || 0); // empuje de campaña del líder
    for (const nb of cityNeighbors[c.homeCity]) {
      const o = t.cities[nb].owner;
      if (o >= 0) inf[o] += NEIGHBOR_INF * t.budgetFactor[o];
    }
    for (let p = 0; p < N; p++) inf[p] *= 0.6 + 0.4 * (t.charisma[p] / maxCharisma);
    let best = -1, bestInf = 0;
    for (let p = 0; p < N; p++) if (inf[p] > bestInf) { bestInf = inf[p]; best = p; }
    if (best < 0 || bestInf <= 0) { if (rng() < 0.015) c.committedFree = true; return; }
    const prob = Math.min(0.9, bestInf * c.openness * JOIN_K);
    if (rng() < prob) {
      c.party = best; c.joined = t.tick; t.recruited[best]++;
      clog(c, `Se afilió a ${t.civs[best].name}`);
      if (rng() < 0.03) log(`🧠 ${c.name} se afilió a ${t.civs[best].name}.`, best);
    } else if (rng() < 0.01) {
      c.committedFree = true; // decides to stay independent for good
    }
  }

  function updateCitizens() {
    const survivors = [];
    const newborns = [];
    for (const c of t.citizens) {
      c.age += 1;
      if (c.age > c.maxAge) { c.dead = true; continue; } // dies of old age
      moveCitizen(c);
      if (c.party < 0 && !c.committedFree && c.age >= c.adultAt && (t.tick + c.id) % AFFIL_EVERY === 0) {
        tryAffiliate(c);
      }
      const home = t.cities[c.homeCity];
      if (c.age >= c.adultAt && (t.tick + c.id) % BIRTH_EVERY === 0 &&
          t.citizens.length + newborns.length < MAX_CITIZENS &&
          home && home.pop < home.capacity && rng() < BIRTH_RATE) {
        const baby = makeCitizen(-1, c.x, c.y); // children are born free-thinkers
        baby.homeCity = c.homeCity;
        newborns.push(baby);
      }
      survivors.push(c);
    }
    t.citizens = survivors.concat(newborns);
  }

  // ---- City ownership ---------------------------------------------------
  function recomputeCityOwners(silent) {
    for (const city of t.cities) { city.tally.fill(0); city.free = 0; }
    for (const c of t.citizens) {
      const city = t.cities[c.homeCity];
      if (!city) continue;
      if (c.party >= 0) city.tally[c.party]++; else city.free++;
    }
    for (const city of t.cities) {
      let best = -1, bn = 1; // need at least 2 affiliated to hold a city
      for (let p = 0; p < N; p++) if (city.tally[p] > bn) { bn = city.tally[p]; best = p; }
      city.pop = city.free + city.tally.reduce((a, b) => a + b, 0);
      if (best !== city.owner) {
        const prev = city.owner;
        city.owner = best;
        clearAlcalde(city); // el/la alcalde/sa anterior ya no representa al pueblo
        if (best >= 0) {
          city.flash = 45;
          if (!silent) {
            if (prev < 0) log(`🏛️ ${t.civs[best].name} se establece en ${city.name}.`, best);
            else log(`🚩 ${t.civs[best].name} le gana ${city.name} a ${t.civs[prev].name}.`, best);
          }
        }
      }
    }
    assignAlcaldes(silent);
  }

  // El/la alcalde/sa es un ciudadano/a REAL del partido dueño, residente del
  // pueblo. Se mantiene mientras siga vivo/a, afiliado/a al dueño y viviendo
  // allí; sólo se re-elige al morir, mudarse, cambiar de partido o cambiar el
  // dueño del pueblo.
  function clearAlcalde(city) {
    // Only strip the citizen's badge if they still belong to THIS city — a
    // migrant may already have become another city's alcalde (alcaldeOf points
    // there), and we must not clobber that newer role.
    const a = city.alcaldeRef;
    if (a && a.alcaldeOf === city.name) { a.isAlcalde = false; a.alcaldeOf = null; }
    city.alcaldeRef = null; city.alcalde = '—';
  }
  function assignAlcaldes(silent) {
    const needSet = new Set();
    for (let i = 0; i < t.cities.length; i++) {
      const city = t.cities[i];
      if (city.owner < 0) { if (city.alcaldeRef) clearAlcalde(city); continue; }
      const a = city.alcaldeRef;
      if (!(a && !a.dead && a.party === city.owner && a.homeCity === i)) needSet.add(i);
    }
    if (!needSet.size) return;
    // Mejor candidato por pueblo: residente afiliado/a más veterano/a que no sea
    // líder ni segundo al mando (un/a local de toda la vida).
    const bestFor = new Map();
    const fallback = new Map(); // permite líder/segundo si no hay nadie más
    for (const c of t.citizens) {
      if (c.party < 0 || c.dead || !needSet.has(c.homeCity)) continue;
      if (c.party !== t.cities[c.homeCity].owner) continue;
      const fb = fallback.get(c.homeCity);
      if (!fb || c.age > fb.age) fallback.set(c.homeCity, c);
      if (c.isLeader || c.isDeputy) continue;
      const cur = bestFor.get(c.homeCity);
      if (!cur || c.age > cur.age) bestFor.set(c.homeCity, c);
    }
    for (const i of needSet) {
      const city = t.cities[i];
      const pick = bestFor.get(i) || fallback.get(i) || null;
      if (city.alcaldeRef && city.alcaldeRef !== pick) clearAlcalde(city);
      if (pick) {
        city.alcaldeRef = pick; city.alcalde = pick.name; city.alcaldeSince = t.tick;
        pick.isAlcalde = true; pick.alcaldeOf = city.name;
        if (!silent) clog(pick, `Nombrado/a alcalde/sa de ${city.name}`);
      }
    }
  }

  // ---- Economy: city worth, party treasury, personal balances -----------
  // recomputeEconomy only recomputes *derived* values (city worth, party
  // treasury, budget factor). It is idempotent and safe to call any number of
  // times (e.g. from god-powers) without changing anyone's money.
  function recomputeEconomy() {
    for (const city of t.cities) {
      city.worth = Math.round(city.base + city.pop * WORTH_K);
    }
    // Party treasury (Presupuesto) = value of owned cities; drives campaigns.
    for (let p = 0; p < N; p++) {
      let sum = 0;
      for (const city of t.cities) if (city.owner === p) sum += city.worth;
      t.budget[p] = sum;
      t.budgetFactor[p] = sum > 0 ? 1 + Math.min(0.8, sum / 16000) : 0.5;
    }
  }
  // accrueIncome pays out wages/salaries. It MUST run on a single fixed cadence
  // (once per ECON_EVERY) — never from powers — so balances grow steadily.
  function accrueIncome() {
    // Personal balances: everyone earns a wage scaled by their city's prosperity.
    for (const c of t.citizens) {
      const city = t.cities[c.homeCity];
      const prosperity = city ? Math.max(0.4, Math.min(2.2, city.worth / 3500)) : 0.5;
      c.balance = Math.min(50_000_000, (c.balance || 0) + Math.round(BASE_WAGE * prosperity));
    }
    // Leaders draw an extra salary from a well-funded party.
    for (let p = 0; p < N; p++) {
      const l = t.leaders[p];
      if (l && !l.dead) l.balance = Math.min(50_000_000, (l.balance || 0) + Math.round(LEADER_SALARY * t.budgetFactor[p]));
    }
  }

  // ---- Stats ------------------------------------------------------------
  function recomputeStats() {
    let free = 0;
    for (let p = 0; p < N; p++) {
      t.stats[p].pop = 0; t.stats[p].units = 0; t.stats[p].cities = 0; t.stats[p].territory = 0;
    }
    for (const c of t.citizens) {
      if (c.party >= 0) { t.stats[c.party].pop++; t.stats[c.party].units++; }
      else free++;
    }
    for (const city of t.cities) if (city.owner >= 0) { t.stats[city.owner].cities++; t.stats[city.owner].territory++; }
    t.freeCount = free;
  }

  // ---- Leadership (no combat: by tenure/age) ----------------------------
  function oldestMember(party, exclude) {
    let best = null;
    for (const c of t.citizens) {
      if (c.party !== party || c.dead || c === exclude) continue;
      if (!best || c.age > best.age) best = c;
    }
    return best;
  }
  // A leader should be experienced but not on death's door: pick the oldest
  // member still under 85% of their lifespan, so leaders actually govern for a
  // while (and the policy brain has time to adapt) instead of dying immediately.
  function pickLeaderCandidate(party) {
    let best = null;
    for (const c of t.citizens) {
      if (c.party !== party || c.dead || c.age >= c.maxAge * 0.85) continue;
      if (!best || c.age > best.age) best = c;
    }
    return best || oldestMember(party, null); // fallback: whoever is left
  }
  function promoteLeader(party, announce) {
    const best = pickLeaderCandidate(party);
    t.leaders[party] = best;
    if (!best) return null;
    const c = t.civs[party];
    best.isLeader = true;
    best.rulerName = c.leader;
    best.title = c.title || 'Líder';
    best.since = t.tick;
    if (best.balance == null) best.balance = 0;
    clog(best, `Asume el liderazgo de ${c.name}`);
    if (announce) log(`👑 ${best.rulerName} encabeza a ${c.name}.`, party);
    return best;
  }
  function checkSuccession() {
    for (let p = 0; p < N; p++) {
      const lead = t.leaders[p];
      if (!lead || lead.dead) {
        const had = !!lead;
        const next = promoteLeader(p, false);
        if (next && had) {
          t.successionLog[p].push({ tick: t.tick });
          if (t.successionLog[p].length > 6) t.successionLog[p].shift();
          if (rng() < 0.5) log(`⚰️ Cae ${t.civs[p].leader} de ${t.civs[p].name}; otro toma el mando.`, p);
        } else if (!next) t.leaders[p] = null;
      }
    }
  }
  function checkDeputy() {
    for (let p = 0; p < N; p++) {
      if (t.stats[p].cities <= 0) continue;
      const d = t.deputy[p];
      if (d && !d.dead) continue;
      const best = oldestMember(p, t.leaders[p]);
      if (best) {
        const dlog = t.deputyLog[p];
        if (dlog.length > 0 && dlog[dlog.length - 1].to === null) dlog[dlog.length - 1].to = t.tick;
        best.isDeputy = true;
        t.deputy[p] = best;
        clog(best, `Nombrado/a segundo al mando de ${t.civs[p].name}`);
        dlog.push({ name: best.name, from: t.tick, to: null });
        if (dlog.length > 8) dlog.shift();
        log(`🎖️ ${best.name} es nombrado segundo al mando de ${t.civs[p].name}.`, p);
      } else t.deputy[p] = null;
    }
  }

  world.leaderStatus = function (p) {
    const l = t.leaders[p];
    if (!l || l.dead) return '— sin líder';
    const owned = t.stats[p].cities;
    if (owned === 0) return '🚶 Buscando apoyo en los pueblos';
    if (t.budgetFactor[p] > 1.3) return '📣 En plena campaña';
    return '🏛️ Gobernando sus pueblos';
  };

  // ---- Inspect helpers --------------------------------------------------
  world.unitAt = function (x, y) {
    let best = null, bd = 6.5; // within ~2.5 tiles
    for (const c of t.citizens) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  world.cityAtTile = function (x, y) {
    let best = null, bd = 14; // within ~3.7 tiles
    for (const c of t.cities) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  // ---- Ambient flavor + summary ----------------------------------------
  function maybeFlavorEvent() {
    if (rng() > 0.03) return;
    const ev = FLAVOR_EVENTS[(rng() * FLAVOR_EVENTS.length) | 0];
    const civIndex = ev.civ === 'any' ? (rng() * N) | 0 : CIV_INDEX[ev.civ];
    const c = t.civs[civIndex];
    if (!c) return;
    log(ev.text.replace('{civ}', c.name), civIndex);
  }
  function shortName(i) { return t.civs[i].name.replace('Los ', ''); }
  function summarize() {
    const total = t.cities.length || 1;
    let lead = 0;
    for (let i = 1; i < N; i++) if (t.stats[i].cities > t.stats[lead].cities) lead = i;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const pct = Math.round((t.stats[i].cities / total) * 100);
      parts.push(`${shortName(i)} ${t.stats[i].cities}c·${pct}%`);
    }
    log(`📊 Estado de la Isla — ${shortName(lead)} al frente. ${parts.join(' · ')} · libres ${t.freeCount}.`, lead);
  }

  // ---- Leaders' policy brain (rule-based, adaptive) ---------------------
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const STANCE = {
    expansion: 'Expansionista', economy: 'Tecnócrata', welfare: 'Populista',
    campaign: 'Movilizador/a', austerity: 'Austero/a',
  };
  function deriveStance(pol) {
    let bestK = 'economy', bestV = -1;
    for (const k of Object.keys(pol)) if (pol[k] > bestV) { bestV = pol[k]; bestK = k; }
    return STANCE[bestK] || 'Tecnócrata';
  }
  // Postura inicial coherente con el ADN sembrado (antes de que corra la IA).
  for (let p = 0; p < N; p++) t.stance[p] = deriveStance(t.policy[p]);
  // El vecino más disputado de un partido (limítrofe a una ciudad suya, lleno
  // de convencibles): el mejor sitio para invertir una campaña.
  function mostContestedNeighbor(p) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < t.cities.length; i++) {
      const c = t.cities[i];
      if (c.owner === p) continue;
      let adj = false;
      for (const nb of cityNeighbors[i]) if (t.cities[nb].owner === p) { adj = true; break; }
      if (!adj) continue;
      let rivals = 0; for (let q = 0; q < N; q++) if (q !== p) rivals += c.tally[q];
      const score = c.free * 1.5 + rivals + (c.owner < 0 ? 4 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  function runLeaderAI(p) {
    const lead = t.leaders[p];
    if (!lead || lead.dead) return;
    const pol = t.policy[p];
    const myCities = [];
    for (const c of t.cities) if (c.owner === p) myCities.push(c);
    const treasury = t.budget[p];
    const delta = myCities.length - t.aiPrevCities[p];
    // Adaptación: si pierde pueblos, refuerza campaña/bienestar; si gana, expande.
    if (delta < 0) { pol.campaign = clamp01(pol.campaign + 0.06); pol.welfare = clamp01(pol.welfare + 0.04); pol.austerity = clamp01(pol.austerity - 0.04); }
    else if (delta > 0) { pol.expansion = clamp01(pol.expansion + 0.03); pol.economy = clamp01(pol.economy + 0.02); }
    if (treasury < 1500) pol.austerity = clamp01(pol.austerity + 0.06);
    else if (treasury > 12000) pol.austerity = clamp01(pol.austerity - 0.05);
    for (const k of Object.keys(pol)) pol[k] = clamp01(pol[k] + (rng() - 0.5) * 0.02); // exploración
    t.stance[p] = deriveStance(pol);
    t.aiPrevCities[p] = myCities.length;

    const willSpend = treasury * (1 - pol.austerity);
    if (willSpend < 400) return; // en quiebra: no hay campañas
    // 1) Campaña en el vecino más disputado.
    if (pol.campaign > 0.4) {
      const target = mostContestedNeighbor(p);
      if (target >= 0) {
        const push = Math.min(6, 1 + willSpend / 4000) * (0.6 + pol.campaign);
        t.cities[target].campaign[p] += push;
      }
    }
    // 2) Inversión en su pueblo más pobre.
    if (pol.economy > 0.4 && myCities.length) {
      let poor = myCities[0]; for (const c of myCities) if (c.base < poor.base) poor = c;
      poor.base += Math.round(300 * pol.economy);
    }
    // 3) Bienestar/fiestas cuando hay holgura.
    if (pol.welfare > 0.55 && treasury > 6000 && myCities.length) {
      const c = myCities[(rng() * myCities.length) | 0];
      c.base += 250; c.campaign[p] += 1.5; c.flash = 30;
    }
  }
  function decayCampaigns() {
    for (const c of t.cities) for (let p = 0; p < N; p++) if (c.campaign[p]) c.campaign[p] *= 0.8;
  }
  function sampleHistory() {
    for (let i = 0; i < t.cities.length; i++) {
      const c = t.cities[i]; const buf = t.cityHistory[i];
      buf.push({ t: t.tick, pop: c.pop, worth: c.worth, owner: c.owner });
      if (buf.length > 240) buf.shift();
    }
    for (let p = 0; p < N; p++) {
      const l = t.leaders[p]; const buf = t.leaderHistory[p];
      buf.push({ t: t.tick, treasury: t.budget[p], cities: t.stats[p].cities, balance: l ? Math.round(l.balance || 0) : 0, stance: t.stance[p] });
      if (buf.length > 240) buf.shift();
    }
  }

  // ---- Main tick --------------------------------------------------------
  function step() {
    t.tick++;
    // Scripted history: fire every event whose game-date we've reached. (The
    // fast-forward loop in main.js advances one tick at a time, so no event is
    // ever skipped over.) The headline is tagged 'hist'; the apply() may log
    // extra mechanical detail (casualties, economy) as normal lines.
    while (t.timelineIdx < TIMELINE.length && t.tick >= dateToTick(TIMELINE[t.timelineIdx].at)) {
      const ev = TIMELINE[t.timelineIdx++];
      log(ev.text, null, 'hist');
      ev.apply(world);
    }
    // Recurring random events keep the island lively (~1–2 per year).
    if (t.tick % 180 === 0 && rng() < 0.6) fireRandomEvent();
    updateCitizens();
    checkSuccession();
    maybeFlavorEvent();
    for (const city of t.cities) if (city.flash > 0) city.flash--;
    if (t.tick % OWNER_EVERY === 0) {
      recomputeCityOwners(false);
      recomputeStats();
      checkDeputy();
    }
    if (t.tick % ECON_EVERY === 0) { recomputeEconomy(); accrueIncome(); }
    // Una vez al mes los líderes piensan, mueven campañas y se registra la historia.
    if (t.tick % 30 === 0) {
      recomputeEconomy(); // valores frescos para el cerebro (sin pagar sueldos)
      for (let p = 0; p < N; p++) runLeaderAI(p);
      decayCampaigns();
      sampleHistory();
    }
    if (t.tick % 120 === 0) {
      t.history.push({
        pop: t.stats.map((s) => s.pop),
        terr: t.stats.map((s) => s.cities),
        budget: t.budget.slice(),
        free: t.freeCount,
      });
      if (t.history.length > 180) t.history.shift();
    }
    if (t.tick % SUMMARY_EVERY === 0) summarize();
  }
  world.step = step;

  // ---- Power hooks (called by powers.js) --------------------------------
  world.damageArea = function (cx, cy, r, dmg, label, killTerrain = false) {
    let cas = 0;
    t.citizens = t.citizens.filter((c) => {
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d <= r && rng() < (1 - d / (r + 1))) { c.dead = true; cas++; return false; }
      return true;
    });
    if (killTerrain) {
      for (let y = (cy - r) | 0; y <= cy + r; y++) for (let x = (cx - r) | 0; x <= cx + r; x++) {
        if (inBounds(x, y) && Math.hypot(x - cx, y - cy) <= r * 0.5 && isLand(t.tiles[idx(x, y)]) && rng() < 0.3) t.tiles[idx(x, y)] = TILE.BEACH;
      }
    }
    if (label) log(label + (cas ? ` (${cas} víctimas)` : ''));
    recomputeCityOwners(true); recomputeStats(); recomputeEconomy();
  };

  world.blackout = function (cx, cy, r) {
    let hit = 0;
    for (const city of t.cities) if (Math.hypot(city.x - cx, city.y - cy) <= r) { city.base = Math.max(150, city.base - 600); hit++; }
    log(`🔌 ¡Apagón de LUMA! ${hit} pueblo(s) a oscuras: cae su economía.`);
    recomputeEconomy();
  };

  // --- Poderes con sabor boricua ----------------------------------------
  world.exodus = function (cx, cy, r) {
    let gone = 0;
    t.citizens = t.citizens.filter((c) => {
      if (Math.hypot(c.x - cx, c.y - cy) <= r && rng() < 0.7) { c.dead = true; gone++; return false; }
      return true;
    });
    log(`✈️ Éxodo: ${gone} boricuas se mudan a la diáspora.`);
    recomputeCityOwners(true); recomputeStats(); recomputeEconomy();
  };

  world.junta = function () {
    for (const city of t.cities) city.base = Math.max(120, Math.round(city.base * 0.8));
    for (const c of t.citizens) c.balance = Math.round((c.balance || 0) * 0.85);
    log('📉 La Junta de Control Fiscal (PROMESA) impone austeridad en toda la isla.');
    recomputeEconomy();
  };

  world.fiestas = function (cx, cy) {
    const ci = nearestCity(cx, cy); const city = t.cities[ci];
    if (!city) return;
    city.base += 700; city.flash = 45;
    if (city.owner >= 0) {
      for (const c of t.citizens) if (c.homeCity === ci && c.party < 0 && !c.committedFree && rng() < 0.5) {
        c.party = city.owner; c.joined = t.tick; t.recruited[city.owner]++;
      }
    }
    log(`🎉 Fiestas patronales en ${city.name}: el pueblo se entusiasma.`, city.owner >= 0 ? city.owner : null);
    recomputeCityOwners(true); recomputeStats(); recomputeEconomy();
  };

  world.inversion = function (cx, cy) {
    const ci = nearestCity(cx, cy); const city = t.cities[ci];
    if (!city) return;
    city.base += 2200; city.flash = 30;
    for (const c of t.citizens) if (c.homeCity === ci) c.balance = (c.balance || 0) + 1500;
    log(`💵 Inversión / fondos federales llegan a ${city.name}.`, city.owner >= 0 ? city.owner : null);
    recomputeEconomy();
  };

  world.plebiscito = function () {
    let moved = 0;
    for (const c of t.citizens) {
      if (c.party >= 0 || c.committedFree || c.age < c.adultAt) continue;
      if (rng() < 0.4) {
        const city = t.cities[c.homeCity];
        const p = (city && city.owner >= 0) ? city.owner : (rng() * N) | 0;
        c.party = p; c.joined = t.tick; t.recruited[p]++; moved++;
      }
    }
    log(`🗳️ Plebiscito de estatus: ${moved} indecisos toman partido.`);
    recomputeCityOwners(true); recomputeStats();
  };

  world.cosecha = function (cx, cy) {
    const ci = nearestCity(cx, cy); const city = t.cities[ci];
    if (!city) return;
    city.base += 1000; city.flash = 30;
    log(`☕ Buena cosecha de café en ${city.name}: sube su valor.`, city.owner >= 0 ? city.owner : null);
    recomputeEconomy();
  };

  // ---- Timeline / historical-event mutators ----------------------------
  world.randomCity = function () { return t.cities[(rng() * t.cities.length) | 0]; };

  // Remove up to `sprites` random citizen-sprites island-wide (death by
  // epidemic). Each sprite ≈ PEOPLE_PER_CITIZEN people, so the log reports the
  // toll in people. Moderate by design: a handful of sprites at a time.
  world.epidemic = function (label, sprites) {
    const target = Math.min(sprites | 0, t.citizens.length);
    const picked = new Set();
    let guard = 0;
    while (picked.size < target && guard++ < target * 40) picked.add((rng() * t.citizens.length) | 0);
    for (const i of picked) {
      const c = t.citizens[i];
      c.dead = true;
      const home = t.cities[c.homeCity];
      if (home) home.flash = 30;
    }
    t.citizens = t.citizens.filter((c) => !c.dead);
    const people = (picked.size * PEOPLE_PER_CITIZEN).toLocaleString('en-US');
    log(`${label}: se lleva ~${people} personas.`, null, 'hist');
    recomputeCityOwners(true); recomputeStats(); recomputeEconomy();
  };

  // Scale every city's economic base (boom > 1, recession < 1). Worth only —
  // never touches personal balances (keeps the income split intact).
  world.economyShift = function (factor, label) {
    for (const city of t.cities) city.base = Math.max(120, Math.round(city.base * factor));
    if (label) log(label, null, 'hist');
    recomputeEconomy();
  };

  // Protest/morale shock: a fraction of affiliated citizens near (cx,cy) break
  // with their party and become free-thinkers again.
  world.protest = function (cx, cy, r, frac, label) {
    let freed = 0;
    for (const c of t.citizens) {
      if (c.party >= 0 && Math.hypot(c.x - cx, c.y - cy) <= r && rng() < frac) {
        c.party = -1; c.committedFree = false; c.joined = null; freed++;
      }
    }
    if (label) log(label, null, 'hist');
    recomputeCityOwners(true); recomputeStats(); recomputeEconomy();
  };

  // Weighted pick from the recurring random-event pool.
  function fireRandomEvent() {
    if (!RANDOM_EVENTS.length) return;
    const total = RANDOM_EVENTS.reduce((a, e) => a + (e.weight || 1), 0);
    let r = rng() * total;
    for (const e of RANDOM_EVENTS) {
      r -= (e.weight || 1);
      if (r <= 0) { e.apply(world, rng()); return; }
    }
  }

  world.reset = function () { /* recreated externally */ };

  // ---- Boot -------------------------------------------------------------
  seedCities();
  seedCitizens();
  return world;
}
