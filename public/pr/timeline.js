/* timeline.js — dated historical events + recurring random events.
 *
 * Pure data, mirroring the powers.js pattern: each entry is data plus an
 * apply(world) (timeline) or apply(world, sev) (random) that calls the engine's
 * public mutators. sim.js consumes this; main.js imports CALENDAR/dateToTick as
 * the single source of truth for the in-game calendar.
 *
 * The simulation calendar starts on 1/1/1948 (1 tick = 1 day; 30-day months;
 * 360-day years). TIMELINE entries are scheduled on GAME dates (years 1948+,
 * compressed into the first game-decade so they're reachable in a session),
 * while their text references the real Puerto Rico event + its real year. The
 * effects are deliberately "moderate": a few citizen-sprites die, a local
 * economy dents, a town may flip — the island keeps evolving, no wipeouts.
 */

export const CALENDAR = { BASE_YEAR: 1948, YEAR_DAYS: 360, MONTH_DAYS: 30 };

// A game date {y,m,d} → absolute tick (day count from 1/1/BASE_YEAR).
export function dateToTick({ y, m = 1, d = 1 }) {
  return (y - CALENDAR.BASE_YEAR) * CALENDAR.YEAR_DAYS + (m - 1) * CALENDAR.MONTH_DAYS + (d - 1);
}

// Helper: the most south-western city (lowest x, highest y) — for the 2020 quakes.
function southwestCity(world) {
  let best = null, bestScore = Infinity;
  for (const c of world.cities) {
    const score = c.x - c.y; // small x (west) + big y (south) → smallest
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best || world.randomCity();
}

// ---- One-time scripted history (must stay in ascending game-date order) ----
export const TIMELINE = [
  {
    at: { y: 1948, m: 6, d: 1 }, icon: '🏗️',
    text: '🏗️ Operación Manos a la Obra: la industrialización dispara la economía (años 1950).',
    apply(w) { w.economyShift(1.15, '🏗️ Operación Manos a la Obra impulsa la economía de la isla.'); },
  },
  {
    at: { y: 1949, m: 3, d: 12 }, icon: '🌀',
    text: '🌀 Huracán Santa Clara (1956) azota la isla.',
    apply(w) { const c = w.randomCity(); w.damageArea(c.x, c.y, 8, 18, '🌀 Huracán Santa Clara (1956) azota ' + c.name + '.', true); },
  },
  {
    at: { y: 1950, m: 1, d: 1 }, icon: '🛢️',
    text: '🛢️ Crisis petrolera de los 70: recesión en toda la isla.',
    apply(w) { w.economyShift(0.85, '🛢️ La crisis petrolera de los 70 golpea la economía.'); },
  },
  {
    at: { y: 1951, m: 6, d: 10 }, icon: '🪖',
    text: '🪖 Cierre de la Marina en Vieques (2003): el pueblo celebra.',
    apply(w) { const c = w.randomCity(); w.fiestas(c.x, c.y); },
  },
  {
    at: { y: 1952, m: 9, d: 1 }, icon: '📉',
    text: '📉 Comienza la quiebra fiscal (2006): se aprietan las arcas.',
    apply(w) { w.economyShift(0.9, '📉 La quiebra fiscal de 2006 reduce el valor de los pueblos.'); },
  },
  {
    at: { y: 1953, m: 7, d: 5 }, icon: '🦟',
    text: '🦟 Epidemia de dengue recorre la isla.',
    apply(w) { w.epidemic('🦟 El dengue', 6); },
  },
  {
    at: { y: 1954, m: 5, d: 1 }, icon: '⚖️',
    text: '⚖️ PROMESA crea la Junta de Control Fiscal (2016).',
    apply(w) { w.junta(); },
  },
  {
    at: { y: 1954, m: 8, d: 20 }, icon: '🦟',
    text: '🦟 Brote de Zika (2016).',
    apply(w) { w.epidemic('🦟 El Zika', 4); },
  },
  {
    at: { y: 1955, m: 7, d: 15 }, icon: '✊',
    text: '✊ Verano del 19 (RickyLeaks): protestas masivas; muchos rompen con su partido.',
    apply(w) { const c = w.randomCity(); w.protest(c.x, c.y, 14, 0.4, '✊ El Verano del 19: el pueblo protesta y muchos se declaran independientes.'); },
  },
  {
    at: { y: 1956, m: 9, d: 20 }, icon: '🌀',
    text: '🌀 Huracán María (2017): la peor tormenta en un siglo.',
    apply(w) {
      const c = w.randomCity();
      w.damageArea(c.x, c.y, 11, 26, '🌀 Huracán María (2017) devasta ' + c.name + ' y sus alrededores.', true);
      w.blackout(c.x, c.y, 16);
    },
  },
  {
    at: { y: 1957, m: 1, d: 7 }, icon: '🌎',
    text: '🌎 Terremotos del suroeste (2020).',
    apply(w) { const c = southwestCity(w); w.damageArea(c.x, c.y, 8, 18, '🌎 Los terremotos de 2020 sacuden el suroeste (' + c.name + ').', false); },
  },
  {
    at: { y: 1957, m: 3, d: 15 }, icon: '😷',
    text: '😷 Llega la pandemia de COVID-19 (2020).',
    apply(w) { w.epidemic('😷 El COVID-19', 8); w.economyShift(0.9, '😷 La pandemia frena la economía.'); },
  },
  {
    at: { y: 1958, m: 6, d: 1 }, icon: '🔌',
    text: '🔌 Era de apagones de LUMA (2021+).',
    apply(w) { const c = w.randomCity(); w.blackout(c.x, c.y, 14); },
  },
  {
    at: { y: 1959, m: 4, d: 1 }, icon: '✈️',
    text: '✈️ Gran éxodo a la diáspora.',
    apply(w) { const c = w.randomCity(); w.exodus(c.x, c.y, 8); },
  },
];

// ---- Recurring random events (keep the island lively after the script) -----
// sev (0..1) scales magnitude. Picked by weight in sim.fireRandomEvent().
export const RANDOM_EVENTS = [
  {
    icon: '🌪️', weight: 3, text: 'tormenta tropical',
    apply(w, sev) { const c = w.randomCity(); w.damageArea(c.x, c.y, 4 + sev * 5, 14, '🌪️ Una tormenta tropical golpea ' + c.name + '.', false); },
  },
  {
    icon: '🦟', weight: 2, text: 'brote epidémico',
    apply(w, sev) { w.epidemic('🦟 Un brote epidémico', 2 + Math.round(sev * 5)); },
  },
  {
    icon: '☀️', weight: 2, text: 'sequía',
    apply(w, sev) { w.economyShift(0.94 - sev * 0.05, '☀️ Una sequía reduce las cosechas.'); },
  },
  {
    icon: '🏖️', weight: 2, text: 'boom turístico',
    apply(w, sev) { w.economyShift(1.06 + sev * 0.06, '🏖️ Un boom turístico anima la economía.'); },
  },
  {
    icon: '☕', weight: 2, text: 'cosecha récord',
    apply(w) { const c = w.randomCity(); w.cosecha(c.x, c.y); },
  },
  {
    icon: '🔌', weight: 2, text: 'apagón',
    apply(w, sev) { const c = w.randomCity(); w.blackout(c.x, c.y, 8 + sev * 8); },
  },
  {
    icon: '🌊', weight: 1, text: 'marejada',
    apply(w, sev) { const c = w.randomCity(); w.damageArea(c.x, c.y, 3 + sev * 3, 12, '🌊 Una marejada ciclónica inunda la costa de ' + c.name + '.', false); },
  },
];
