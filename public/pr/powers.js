/* powers.js — poderes divinos con sabor de Puerto Rico.
 *
 * Cada poder define una herramienta del panel y un apply() que altera el mundo
 * en la casilla pulsada. Se eliminaron los poderes de fantasía (dragón, OVNI,
 * meteorito, volcán, tornado, rayo, plaga); ahora todo va con la historia real
 * de Puerto Rico: huracanes, terremotos, apagones, éxodo, la Junta, fiestas
 * patronales, inversión federal, plebiscito y la cosecha de café.
 */

export const POWERS = [
  {
    id: 'inspect',
    label: 'Mirar',
    icon: '👆',
    desc: 'Toca una persona 👑 o un pueblo para ver sus datos. Arrastra para mover, pellizca/rueda para acercar.',
    apply() {},
  },
  {
    id: 'spawn',
    label: 'Sembrar gente',
    icon: '👶',
    needsCiv: true,
    desc: 'Suelta nuevos seguidores del partido elegido.',
    apply(world, x, y, civIndex) {
      for (let i = 0; i < 3; i++) world.spawnUnit(civIndex, x, y);
    },
  },
  {
    id: 'free',
    label: 'Librepensadores',
    icon: '🧠',
    desc: 'Suelta gente indecisa que vagará y quizás se afilie a un partido.',
    apply(world, x, y) {
      for (let i = 0; i < 6; i++) world.spawnFree(x, y);
    },
  },
  // --- Desastres boricuas ---
  {
    id: 'hurricane',
    label: 'Huracán María',
    icon: '🌀',
    desc: 'Un huracán monstruoso arrasa la región: víctimas y destrucción.',
    apply(world, x, y) {
      world.damageArea(x, y, 9, 22, '🌀 ¡El huracán María toca tierra!', true);
    },
  },
  {
    id: 'quake',
    label: 'Terremoto 2020',
    icon: '🌎',
    desc: 'Un temblor agrieta el suroeste de la isla.',
    apply(world, x, y) {
      world.damageArea(x, y, 7, 18, '🌎 ¡Un terremoto sacude la isla!', false);
    },
  },
  {
    id: 'blackout',
    label: 'Apagón (LUMA)',
    icon: '🔌',
    desc: 'Corta la luz: la economía de los pueblos cercanos se desploma.',
    apply(world, x, y) {
      world.blackout(x, y, 12);
    },
  },
  {
    id: 'exodus',
    label: 'Éxodo',
    icon: '✈️',
    desc: 'La gente de la zona emigra a la diáspora y los pueblos se vacían.',
    apply(world, x, y) {
      world.exodus(x, y, 7);
    },
  },
  {
    id: 'junta',
    label: 'La Junta (PROMESA)',
    icon: '📉',
    desc: 'Austeridad fiscal en toda la isla: se aprietan las arcas y los bolsillos.',
    apply(world) {
      world.junta();
    },
  },
  // --- Bendiciones boricuas ---
  {
    id: 'fiestas',
    label: 'Fiestas patronales',
    icon: '🎉',
    desc: 'Anima a un pueblo: sube su valor y la gente se entusiasma con el partido local.',
    apply(world, x, y) {
      world.fiestas(x, y);
    },
  },
  {
    id: 'inversion',
    label: 'Inversión federal',
    icon: '💵',
    desc: 'Inyecta fondos a un pueblo: sube su valor y el bolsillo de su gente.',
    apply(world, x, y) {
      world.inversion(x, y);
    },
  },
  {
    id: 'cosecha',
    label: 'Cosecha de café',
    icon: '☕',
    desc: 'Una buena cosecha sube el valor económico del pueblo.',
    apply(world, x, y) {
      world.cosecha(x, y);
    },
  },
  {
    id: 'plebiscito',
    label: 'Plebiscito',
    icon: '🗳️',
    desc: 'Un plebiscito de estatus: muchos indecisos toman partido de golpe.',
    apply(world) {
      world.plebiscito();
    },
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p]));
