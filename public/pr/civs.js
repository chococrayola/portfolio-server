/* civs.js — the three civilizations.
 *
 * Each civ maps a real Puerto Rican political party onto a set of game traits.
 * The traits are grounded in the parties' actual positions (statehood vs.
 * commonwealth vs. independence, relative size, history) but tuned for a
 * satirical sandbox: Los PNP are loud, brutal, and not the sharpest machetes
 * in the cane field; Los PPD are the deal-making establishment; and Los
 * Independentistas are the brainy underdog who fight like the devil in the
 * mountains.
 *
 * Traits are on a 0..10 scale and are read by the simulation each tick.
 */

export const CIVS = [
  {
    id: 'pnp',
    name: 'Los PNP',
    full: 'Partido Nuevo Progresista',
    motto: '¡Estadidad ya!', // statehood now
    color: '#1f6fde', // blue
    colorDark: '#1550a0',
    founded: 1967,
    traits: {
      aggression: 9, // quick to start fights
      brutality: 9, // hit hard, take no prisoners
      intelligence: 2, // ...not a lot going on upstairs
      expansion: 8, // annex everything in sight
      growth: 7, // big base
      diplomacy: 2, // can't read the room
      resilience: 5,
    },
    specials: { coastBonus: true }, // "Anexión": drawn to the coast (join the mainland)
    blurb: 'Statehood hardliners. Most numerous, most brutal, least clever. ' +
      'They annex first and ask questions never.',
  },
  {
    id: 'ppd',
    name: 'Los PPD',
    full: 'Partido Popular Democrático',
    motto: 'Pan, Tierra y Libertad', // bread, land, liberty
    color: '#d6322e', // red
    colorDark: '#9c211e',
    founded: 1938,
    traits: {
      aggression: 5,
      brutality: 4,
      intelligence: 6,
      expansion: 6,
      growth: 8, // strong machine, big turnout
      diplomacy: 9, // masters of the deal and the status quo
      resilience: 6,
    },
    specials: { holdBonus: true }, // "Status Quo": tougher while defending held ground
    blurb: 'The commonwealth establishment. Status-quo machine politicians who ' +
      'grow fast, defend well, and would rather make a deal than a war.',
  },
  {
    id: 'ind',
    name: 'Los Independentistas',
    full: 'Partido Independentista Puertorriqueño',
    motto: '¡Que viva Puerto Rico libre!', // long live a free PR
    color: '#23a455', // green
    colorDark: '#177a3c',
    founded: 1946,
    traits: {
      aggression: 4,
      brutality: 3,
      intelligence: 9, // the brains of the operation
      expansion: 4,
      growth: 5,
      diplomacy: 6,
      resilience: 9, // never truly defeated
    },
    specials: { guerrilla: true, revive: true }, // jungle/mountain edge + La Resistencia
    blurb: 'The independence underdog. Small but brilliant and impossible to ' +
      'stamp out — deadly in the mountains and the rainforest.',
  },
];

export const CIV_INDEX = Object.fromEntries(CIVS.map((c, i) => [c.id, i]));

// City name pools, vaguely flavored per civ.
export const CITY_NAMES = [
  'Bayamón', 'Caguas', 'Ponce', 'Mayagüez', 'Arecibo', 'Guaynabo', 'Carolina',
  'Humacao', 'Aguadilla', 'Fajardo', 'Cayey', 'Yauco', 'Utuado', 'Lares',
  'Manatí', 'Cabo Rojo', 'Coamo', 'Guayama', 'Juncos', 'Vega Baja', 'Isabela',
  'Camuy', 'Maricao', 'Adjuntas', 'Jayuya', 'Naranjito', 'Comerío', 'Patillas',
  'Salinas', 'Loíza', 'Río Grande', 'Toa Alta', 'Aibonito', 'Barranquitas',
];

// Satirical random world events. {text} can use {civ}; weight ~ rarity.
export const FLAVOR_EVENTS = [
  { kind: 'debuff', stat: 'growth', civ: 'pnp', text: '🔌 Apagón general: LUMA leaves {civ} in the dark again.' },
  { kind: 'debuff', stat: 'diplomacy', civ: 'pnp', text: '💸 Corruption scandal rocks {civ}; nobody is surprised.' },
  { kind: 'buff', stat: 'growth', civ: 'ppd', text: '🤝 {civ} cuts a backroom deal; the machine hums along.' },
  { kind: 'buff', stat: 'resilience', civ: 'ind', text: '✊ {civ} hold a rally in the plaza; morale soars.' },
  { kind: 'debuff', stat: 'growth', civ: 'any', text: '🦟 Dengue outbreak slows {civ}.' },
  { kind: 'buff', stat: 'aggression', civ: 'pnp', text: '📣 A {civ} debate gets out of hand; tempers flare.' },
  { kind: 'buff', stat: 'growth', civ: 'any', text: '🏝️ Tourism season booms for {civ}.' },
  { kind: 'debuff', stat: 'growth', civ: 'any', text: '📉 Austerity board (la Junta) squeezes {civ}.' },
  { kind: 'buff', stat: 'diplomacy', civ: 'ppd', text: '🎩 {civ} don the pava and win over the countryside.' },
  { kind: 'buff', stat: 'intelligence', civ: 'ind', text: '📚 {civ} pack the university; new ideas spread.' },
  { kind: 'debuff', stat: 'intelligence', civ: 'pnp', text: '🤡 {civ} misread the map and march into a swamp.' },
];

// Ruler titles per party + name pools (generic PR-flavored, not real people).
export const RULER_TITLE = { pnp: 'Gobernador', ppd: 'Gobernador', ind: 'Líder' };
export const RULER_FIRST = [
  'Juan', 'Pedro', 'Luis', 'Carlos', 'José', 'Ramón', 'Héctor', 'Rafael', 'Ana',
  'María', 'Carmen', 'Sonia', 'Wanda', 'Pedro Pablo', 'Jenniffer', 'Aníbal',
  'Sila', 'Roberto', 'Ricardo', 'Alejandro', 'Tomás', 'Eduardo', 'Gloria',
];
export const RULER_LAST = [
  'Rivera', 'Rodríguez', 'Colón', 'Vega', 'Santiago', 'Ortiz', 'Torres',
  'Marín', 'Ferré', 'Acevedo', 'Calderón', 'Rosselló', 'Pierluisi', 'Fortuño',
  'Concepción', 'Berríos', 'Albizu', 'Muñoz', 'Romero', 'Quiñones', 'del Valle',
];

/** Deep-copy the default civ definitions so traits can be edited at runtime. */
export function defaultCivs() {
  return CIVS.map((c) => ({
    ...c,
    traits: { ...c.traits },
    specials: { ...c.specials },
  }));
}
