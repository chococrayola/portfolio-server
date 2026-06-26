/* powers.js — la caja de poderes divinos (en español).
 *
 * Cada poder define una herramienta del panel y un apply() que altera el mundo
 * en la casilla pulsada. Los marcados con needsCiv usan el partido elegido en
 * la interfaz (crear, bendecir). Los desastres llevan sabor boricua: el huracán
 * María, los terremotos de 2020 y los eternos apagones de LUMA.
 */

import { TILE } from './map.js?v=22';

export const POWERS = [
  {
    id: 'inspect',
    label: 'Mirar',
    icon: '👆',
    desc: 'Toca una persona 👑 o ciudad para ver sus datos. Arrastra para mover, pellizca/rueda para acercar.',
    apply() {},
  },
  {
    id: 'spawn',
    label: 'Crear',
    icon: '👶',
    needsCiv: true,
    desc: 'Suelta un nuevo seguidor del partido elegido.',
    apply(world, x, y, civIndex) {
      for (let i = 0; i < 3; i++) world.spawnUnit(civIndex, x, y);
    },
  },
  {
    id: 'free',
    label: 'Librepensadores',
    icon: '🧠',
    desc: 'Suelta gente indecisa que vagará y quizás se una a un partido.',
    apply(world, x, y) {
      for (let i = 0; i < 6; i++) world.spawnFree(x, y);
    },
  },
  {
    id: 'bless',
    label: 'Bendecir',
    icon: '✨',
    needsCiv: true,
    desc: 'Sana a un partido, hace crecer sus ciudades y mejora sus relaciones.',
    apply(world, x, y, civIndex) {
      world.blessCiv(civIndex);
    },
  },
  {
    id: 'hurricane',
    label: 'Huracán María',
    icon: '🌀',
    desc: 'Un huracán monstruoso arrasa todo a su paso.',
    apply(world, x, y) {
      world.damageArea(x, y, 9, 22, '🌀 ¡El huracán María toca tierra!', true);
    },
  },
  {
    id: 'quake',
    label: 'Terremoto',
    icon: '🌎',
    desc: 'Un temblor agrieta la tierra (2020, no se olvida).',
    apply(world, x, y) {
      world.damageArea(x, y, 7, 18, '🌎 ¡Un terremoto sacude la isla!', false);
    },
  },
  {
    id: 'meteor',
    label: 'Meteorito',
    icon: '☄️',
    desc: 'Un impacto de meteorito. Bíblico e indiscriminado.',
    apply(world, x, y) {
      world.damageArea(x, y, 6, 40, '☄️ ¡Un meteorito impacta Puerto Rico!', true);
    },
  },
  {
    id: 'plague',
    label: 'Plaga',
    icon: '🦠',
    desc: 'Una enfermedad se propaga entre la población.',
    apply(world, x, y) {
      world.damageArea(x, y, 8, 12, '🦠 Una plaga se riega por los pueblos.', false);
    },
  },
  {
    id: 'lightning',
    label: 'Rayo',
    icon: '⚡',
    desc: 'Un rayo certero desde los cielos.',
    apply(world, x, y) {
      world.damageArea(x, y, 2, 60, '⚡ ¡Cae un rayo!', false);
    },
  },
  {
    id: 'dragon',
    label: 'Dragón',
    icon: '🐉',
    desc: 'Desata un dragón que escupe fuego sobre la zona.',
    apply(world, x, y) {
      world.spawnDragon(x, y);
    },
  },
  {
    id: 'ufo',
    label: 'OVNI',
    icon: '🛸',
    desc: 'Un platillo volador que abduce a la gente.',
    apply(world, x, y) {
      world.spawnUfo(x, y);
    },
  },
  {
    id: 'volcano',
    label: 'Volcán',
    icon: '🌋',
    desc: 'Levanta un volcán que entra en erupción con lava.',
    apply(world, x, y) {
      world.eruptVolcano(x, y);
    },
  },
  {
    id: 'tornado',
    label: 'Tornado',
    icon: '🌪️',
    desc: 'Genera un tornado que deambula y lanza unidades.',
    apply(world, x, y) {
      world.spawnTornado(x, y);
    },
  },
  {
    id: 'blackout',
    label: 'Apagón (LUMA)',
    icon: '🔌',
    desc: 'Corta la luz. Las ciudades dejan de crecer y se encogen.',
    apply(world, x, y) {
      world.blackout(x, y, 12);
    },
  },
  {
    id: 'land',
    label: 'Crear tierra',
    icon: '🟫',
    desc: 'Convierte el mar en pradera.',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.GRASS);
    },
  },
  {
    id: 'water',
    label: 'Inundar',
    icon: '🌊',
    desc: 'Convierte la tierra en mar (ahoga unidades).',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.OCEAN);
    },
  },
  {
    id: 'mountain',
    label: 'Montaña',
    icon: '⛰️',
    desc: 'Levanta montañas (gran terreno guerrillero).',
    apply(world, x, y) {
      world.terraform(x, y, 1, TILE.MOUNTAIN);
    },
  },
  {
    id: 'forest',
    label: 'Bosque',
    icon: '🌳',
    desc: 'Hace crecer un bosque.',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.FOREST);
    },
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p]));
