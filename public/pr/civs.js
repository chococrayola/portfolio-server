/* civs.js — los partidos.
 *
 * Cada partido mapea una fuerza política real de Puerto Rico a un conjunto de
 * rasgos de juego. Los rasgos se basan en las posiciones reales (estadidad,
 * estado libre asociado, independencia, anticorrupción, etc.) pero ajustados
 * para un sandbox satírico. Todo el juego está en español.
 *
 * Rasgos en escala 0..10; el motor los lee en cada turno.
 */

export const CIVS = [
  {
    id: 'pnp',
    name: 'Los PNP',
    full: 'Partido Nuevo Progresista',
    leader: 'Jenniffer González',
    title: 'Gobernadora',
    motto: '¡Estadidad ya!',
    color: '#1f6fde',
    colorDark: '#1550a0',
    founded: 1967,
    start: { units: 8, cityPop: 12 },
    traits: { aggression: 9, brutality: 9, intelligence: 2, expansion: 8, growth: 7, diplomacy: 2, resilience: 5 },
    specials: { coastBonus: true },
    blurb: 'Estadistas de línea dura. Los más numerosos, los más brutales y los ' +
      'menos astutos. Anexan primero y preguntan nunca.',
  },
  {
    id: 'ppd',
    name: 'Los PPD',
    full: 'Partido Popular Democrático',
    leader: 'Pablo José Hernández',
    title: 'Líder',
    motto: 'Pan, Tierra y Libertad',
    color: '#d6322e',
    colorDark: '#9c211e',
    founded: 1938,
    start: { units: 8, cityPop: 12 },
    traits: { aggression: 5, brutality: 4, intelligence: 6, expansion: 6, growth: 8, diplomacy: 9, resilience: 6 },
    specials: { holdBonus: true },
    blurb: 'El establishment del Estado Libre Asociado. Maquinaria política del ' +
      'statu quo: crecen rápido, defienden bien y prefieren un pacto a una guerra.',
  },
  {
    id: 'mvc',
    name: 'MVC',
    full: 'Movimiento Victoria Ciudadana',
    leader: 'Manuel Natal',
    title: 'Líder',
    motto: 'Contra la corrupción y el bipartidismo',
    color: '#7d3cc9',
    colorDark: '#5a2a93',
    founded: 2019,
    start: { units: 5, cityPop: 8 },
    traits: { aggression: 4, brutality: 2, intelligence: 9, expansion: 5, growth: 6, diplomacy: 8, resilience: 7 },
    specials: { recruiter: true }, // atrae a los librepensadores
    blurb: 'Movimiento progresista y anticorrupción que rompe el bipartidismo. ' +
      'Idealistas, brillantes y magnéticos para los indecisos.',
  },
  {
    id: 'ind',
    name: 'PIP',
    full: 'Partido Independentista Puertorriqueño',
    leader: 'Juan Dalmau',
    title: 'Líder',
    motto: '¡Que viva Puerto Rico libre!',
    color: '#23a455',
    colorDark: '#177a3c',
    founded: 1946,
    start: { units: 5, cityPop: 8 },
    traits: { aggression: 4, brutality: 3, intelligence: 9, expansion: 4, growth: 5, diplomacy: 6, resilience: 9 },
    specials: { guerrilla: true, revive: true },
    blurb: 'La independencia indomable. Pocos pero brillantes e imposibles de ' +
      'exterminar — letales en la montaña y el bosque.',
  },
  {
    id: 'molina',
    name: 'Eliezer Molina',
    full: 'Candidatura Independiente',
    leader: 'Eliezer Molina',
    title: 'Candidato',
    motto: 'El pueblo contra la clase política',
    color: '#e6892b',
    colorDark: '#b5651a',
    founded: 2020,
    start: { units: 2, cityPop: 5 },
    traits: { aggression: 6, brutality: 3, intelligence: 6, expansion: 3, growth: 3, diplomacy: 8, resilience: 8 },
    specials: { viral: true, lone: true }, // un solo hombre, pero viral
    blurb: 'Un solo hombre contra todos. Agricultor y outsider populista sin ' +
      'maquinaria, pero viral y combativo: convence multitudes desde cero.',
  },
];

export const CIV_INDEX = Object.fromEntries(CIVS.map((c, i) => [c.id, i]));

// Nombres de municipios para bautizar ciudades.
export const CITY_NAMES = [
  'Bayamón', 'Caguas', 'Ponce', 'Mayagüez', 'Arecibo', 'Guaynabo', 'Carolina',
  'Humacao', 'Aguadilla', 'Fajardo', 'Cayey', 'Yauco', 'Utuado', 'Lares',
  'Manatí', 'Cabo Rojo', 'Coamo', 'Guayama', 'Juncos', 'Vega Baja', 'Isabela',
  'Camuy', 'Maricao', 'Adjuntas', 'Jayuya', 'Naranjito', 'Comerío', 'Patillas',
  'Salinas', 'Loíza', 'Río Grande', 'Toa Alta', 'Aibonito', 'Barranquitas',
];

// Eventos satíricos aleatorios. {civ} se reemplaza por el nombre del partido.
export const FLAVOR_EVENTS = [
  // PNP — estadistas de línea dura
  { civ: 'pnp', text: '🔌 Apagón general: LUMA deja a {civ} a oscuras otra vez.' },
  { civ: 'pnp', text: '💸 Escándalo de corrupción sacude a {civ}; nadie se sorprende.' },
  { civ: 'pnp', text: '🤡 {civ} leyó mal el mapa y marchó hacia un pantano.' },
  { civ: 'pnp', text: '🗳️ {civ} convoca otro plebiscito de estadidad… el quinto ya.' },
  { civ: 'pnp', text: '🇺🇸 {civ} pinta otra estrella 51 en la plaza pública.' },
  { civ: 'pnp', text: '🏗️ {civ} inaugura una obra a medio terminar con bombo y platillo.' },
  // PPD — la maquinaria del ELA
  { civ: 'ppd', text: '🤝 {civ} cuadra un pacto entre bastidores; la maquinaria ronronea.' },
  { civ: 'ppd', text: '🎩 {civ} se pone la pava y conquista el campo.' },
  { civ: 'ppd', text: '🍢 {civ} reparte lechón y pasteles en la asamblea del partido.' },
  { civ: 'ppd', text: '📻 {civ} domina la radio con jingles pegajosos.' },
  { civ: 'ppd', text: '🏛️ {civ} promete autonomía… mañana, siempre mañana.' },
  // MVC — anticorrupción y juventud
  { civ: 'mvc', text: '✊ {civ} llena la plaza con una marcha anticorrupción.' },
  { civ: 'mvc', text: '📚 {civ} copa la universidad; las ideas nuevas se riegan.' },
  { civ: 'mvc', text: '🔍 {civ} destapa un chat vergonzoso y la gente estalla.' },
  { civ: 'mvc', text: '🎓 {civ} gana el voto joven con un meme certero.' },
  { civ: 'mvc', text: '♻️ {civ} organiza una limpieza de playas multitudinaria.' },
  // PIP / Independentistas
  { civ: 'ind', text: '🌿 {civ} iza la monoestrellada en la montaña; sube la moral.' },
  { civ: 'ind', text: '🎶 Una peña de {civ} canta a Lares hasta el amanecer.' },
  { civ: 'ind', text: '📜 {civ} recuerda el Grito de Lares y enciende los ánimos.' },
  { civ: 'ind', text: '🐸 {civ} adopta el coquí como símbolo de resistencia.' },
  { civ: 'ind', text: '🌾 {civ} defiende la tierra contra otra megatienda.' },
  // Eliezer Molina — independiente popular
  { civ: 'molina', text: '📱 Un video de {civ} se hace viral y arrasa en las redes.' },
  { civ: 'molina', text: '🚜 {civ} reparte cosecha del país y gana corazones.' },
  { civ: 'molina', text: '🎣 {civ} llega en lancha a un pueblo costero a dar la mano.' },
  { civ: 'molina', text: '🛠️ {civ} arregla un tramo de carretera que el gobierno olvidó.' },
  // any — sabor de toda la isla
  { civ: 'any', text: '🦟 Brote de dengue ralentiza a {civ}.' },
  { civ: 'any', text: '🏝️ Temporada turística en auge para {civ}.' },
  { civ: 'any', text: '📉 La Junta de Control Fiscal aprieta a {civ}.' },
  { civ: 'any', text: '🎉 Las fiestas de la Calle San Sebastián paralizan a {civ}.' },
  { civ: 'any', text: '🥁 La fiesta de Santiago Apóstol en Loíza retumba para {civ}.' },
  { civ: 'any', text: '⚾ La novena del pueblo de {civ} gana el campeonato de la Doble A.' },
  { civ: 'any', text: '🎺 Una descarga de salsa une a la gente de {civ}.' },
  { civ: 'any', text: '☕ Cosecha récord de café en la altura favorece a {civ}.' },
  { civ: 'any', text: '🍌 Sube el precio del plátano y todos miran a {civ}.' },
  { civ: 'any', text: '🌀 Un huracán amenaza y {civ} corre a los colmados.' },
  { civ: 'any', text: '🌊 Una marejada ciclónica azota la costa de {civ}.' },
  { civ: 'any', text: '🌎 Un temblor sacude la isla; {civ} aguanta la respiración.' },
  { civ: 'any', text: '🎆 Noche de San Juan: todos se tiran al mar de espaldas por {civ}.' },
  { civ: 'any', text: '🍢 Festival del pastel y la alcapurria desborda la plaza de {civ}.' },
  { civ: 'any', text: '📰 Un editorial del periódico elogia (o destroza) a {civ}.' },
];

// Nombres de ciudadanos: figuras boricuas (próceres, artistas, atletas,
// políticos). Solo nombres, como sabor para la gente que camina por la isla.
export const CITIZEN_NAMES = [
  'Roberto Clemente', 'Rita Moreno', 'Pedro Albizu Campos', 'Luis Muñoz Marín',
  'Ramón Emeterio Betances', 'Eugenio María de Hostos', 'Julia de Burgos',
  'Lola Rodríguez de Tió', 'José de Diego', 'Felisa Rincón de Gautier',
  'Rafael Hernández', 'Tito Puente', 'Héctor Lavoe', 'Ismael Rivera',
  'Cheo Feliciano', 'Bobby Capó', 'Andy Montañez', 'Gilberto Santa Rosa',
  'Marc Anthony', 'Ricky Martin', 'Chayanne', 'Olga Tañón', 'Ednita Nazario',
  'Daddy Yankee', 'Bad Bunny', 'Residente', 'Tego Calderón', 'Ozuna',
  'Wisin', 'Yandel', 'Don Omar', 'iLe', 'Kany García', 'Jennifer López',
  'Benicio del Toro', 'Raúl Juliá', 'José Ferrer', 'Roselyn Sánchez',
  'Joaquín Phoenix', 'Esai Morales', 'Carlos Beltrán', 'Iván Rodríguez',
  'Roberto Alomar', 'Bernie Williams', 'Mónica Puig', 'Gigi Fernández',
  'Félix Trinidad', 'Miguel Cotto', 'Sila María Calderón', 'Luis A. Ferré',
  'Rafael Cordero', 'Roberto Cofresí', 'Sylvia Rexach', 'Myrta Silva',
  'Francisco Oller', 'Rafael Tufiño', 'José Campeche', 'René Marqués',
  'Giannina Braschi', 'Esmeralda Santiago', 'Jesús Colón', 'Antonia Pantoja',
  'Nydia Velázquez', 'Sonia Sotomayor', 'Rosario Ferré', 'Tony Croatto',
];

export function defaultCivs() {
  return CIVS.map((c) => ({
    ...c,
    traits: { ...c.traits },
    specials: { ...c.specials },
    start: { ...c.start },
  }));
}
