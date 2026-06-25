/* powers.js — the god toolbox.
 *
 * Each power describes a tool in the palette and an apply() that mutates the
 * world at the clicked tile. Powers flagged needsCiv use the civ picked in the
 * UI (spawn, bless). PR-flavored disasters lean into the island's real
 * history: Hurricane María, the 2020 earthquakes, and the endless LUMA
 * blackouts.
 */

import { TILE } from './map.js';

export const POWERS = [
  {
    id: 'inspect',
    label: 'Look',
    icon: '👆',
    desc: 'Tap a person 👑 or city for stats. Drag to pan, pinch/scroll to zoom.',
    apply() {},
  },
  {
    id: 'spawn',
    label: 'Spawn',
    icon: '👶',
    needsCiv: true,
    desc: 'Drop a new citizen of the chosen party.',
    apply(world, x, y, civIndex) {
      for (let i = 0; i < 3; i++) world.spawnUnit(civIndex, x, y);
    },
  },
  {
    id: 'bless',
    label: 'Bless',
    icon: '✨',
    needsCiv: true,
    desc: 'Heal a party, grow its cities, and warm relations.',
    apply(world, x, y, civIndex) {
      world.blessCiv(civIndex);
    },
  },
  {
    id: 'hurricane',
    label: 'Huracán María',
    icon: '🌀',
    desc: 'A monster hurricane flattens everything it touches.',
    apply(world, x, y) {
      world.damageArea(x, y, 9, 22, '🌀 Huracán María makes landfall!', true);
    },
  },
  {
    id: 'quake',
    label: 'Terremoto',
    icon: '🌎',
    desc: 'An earthquake cracks the ground (2020, never forget).',
    apply(world, x, y) {
      world.damageArea(x, y, 7, 18, '🌎 A terremoto shakes the island!', false);
    },
  },
  {
    id: 'meteor',
    label: 'Meteor',
    icon: '☄️',
    desc: 'A meteor strike. Biblical, indiscriminate.',
    apply(world, x, y) {
      world.damageArea(x, y, 6, 40, '☄️ A meteor slams into Puerto Rico!', true);
    },
  },
  {
    id: 'plague',
    label: 'Plague',
    icon: '🦠',
    desc: 'A sickness sweeps through the population.',
    apply(world, x, y) {
      world.damageArea(x, y, 8, 12, '🦠 A plague spreads through the towns.', false);
    },
  },
  {
    id: 'lightning',
    label: 'Smite',
    icon: '⚡',
    desc: 'A precise bolt from the heavens.',
    apply(world, x, y) {
      world.damageArea(x, y, 2, 60, '⚡ A bolt of lightning strikes!', false);
    },
  },
  {
    id: 'dragon',
    label: 'Dragon',
    icon: '🐉',
    desc: 'Unleash a fire-breathing dragon on the area.',
    apply(world, x, y) {
      world.spawnDragon(x, y);
    },
  },
  {
    id: 'ufo',
    label: 'UFO',
    icon: '🛸',
    desc: 'A flying saucer that abducts the locals.',
    apply(world, x, y) {
      world.spawnUfo(x, y);
    },
  },
  {
    id: 'volcano',
    label: 'Volcano',
    icon: '🌋',
    desc: 'Raise a volcano that erupts with lava.',
    apply(world, x, y) {
      world.eruptVolcano(x, y);
    },
  },
  {
    id: 'tornado',
    label: 'Tornado',
    icon: '🌪️',
    desc: 'Spawn a twister that roams and flings units.',
    apply(world, x, y) {
      world.spawnTornado(x, y);
    },
  },
  {
    id: 'wildlife',
    label: 'Wildlife',
    icon: '🐑',
    desc: 'Drop a little flock of sheep (and a wolf or two).',
    apply(world, x, y) {
      const A = world.ANIMAL;
      for (let i = 0; i < 5; i++) world.spawnAnimal(A.SHEEP, x, y);
      world.spawnAnimal(A.WOLF, x, y);
    },
  },
  {
    id: 'blackout',
    label: 'Apagón (LUMA)',
    icon: '🔌',
    desc: 'Cut the power. Cities stop growing and shrink.',
    apply(world, x, y) {
      world.blackout(x, y, 12);
    },
  },
  {
    id: 'land',
    label: 'Raise Land',
    icon: '🟫',
    desc: 'Terraform ocean into grassland.',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.GRASS);
    },
  },
  {
    id: 'water',
    label: 'Flood',
    icon: '🌊',
    desc: 'Terraform land into ocean (drowns units).',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.OCEAN);
    },
  },
  {
    id: 'mountain',
    label: 'Mountain',
    icon: '⛰️',
    desc: 'Raise mountains (great guerrilla terrain).',
    apply(world, x, y) {
      world.terraform(x, y, 1, TILE.MOUNTAIN);
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    icon: '🌳',
    desc: 'Grow a forest.',
    apply(world, x, y) {
      world.terraform(x, y, 2, TILE.FOREST);
    },
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p]));
