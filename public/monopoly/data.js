// Monopolio Boricua — static game data
// Official Monopoly prices/rents/mechanics, Puerto Rico names + Spanglish flavor.

export const GROUPS = {
  brown:  { label: 'La Montaña',   color: '#c47a45', members: [1, 3] },
  lblue:  { label: 'Playita',      color: '#4fd8f0', members: [6, 8, 9] },
  pink:   { label: 'Chinchorreo',  color: '#ff4fa3', members: [11, 13, 14] },
  orange: { label: 'Costa Oeste',  color: '#ff8e2b', members: [16, 18, 19] },
  red:    { label: 'Área Metro',   color: '#ff4444', members: [21, 23, 24] },
  yellow: { label: 'Los Chavos',   color: '#ffd400', members: [26, 27, 29] },
  green:  { label: 'Fancy',        color: '#2eff9e', members: [31, 32, 34] },
  dblue:  { label: 'Turisteo',     color: '#5c86ff', members: [37, 39] },
};

// rents: [base, 1 casa, 2 casas, 3 casas, 4 casas, hotel]
export const SPACES = [
  { i: 0,  type: 'go',     name: 'La Salida', blurb: 'Cobra $200 al pasar. Ni PAN ni cupones: chavos limpios.' },
  { i: 1,  type: 'prop',   name: 'Maricao',        group: 'brown',  price: 60,  houseCost: 50,  rents: [2, 10, 30, 90, 160, 250] },
  { i: 2,  type: 'chest',  name: 'El Corillo' },
  { i: 3,  type: 'prop',   name: 'Las Marías',     group: 'brown',  price: 60,  houseCost: 50,  rents: [4, 20, 60, 180, 320, 450] },
  { i: 4,  type: 'tax',    name: 'IVU Sorpresa', amount: 200, blurb: 'Hacienda te encontró. Paga $200.' },
  { i: 5,  type: 'rail',   name: 'Tren Urbano: Sagrado Corazón', price: 200 },
  { i: 6,  type: 'prop',   name: 'Cabo Rojo',      group: 'lblue',  price: 100, houseCost: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { i: 7,  type: 'chance', name: '¿Qué Pasó?' },
  { i: 8,  type: 'prop',   name: 'Rincón',         group: 'lblue',  price: 100, houseCost: 50,  rents: [6, 30, 90, 270, 400, 550] },
  { i: 9,  type: 'prop',   name: 'Isabela',        group: 'lblue',  price: 120, houseCost: 50,  rents: [8, 40, 100, 300, 450, 600] },
  { i: 10, type: 'jail',   name: 'El Oso Blanco', blurb: 'De visita... por ahora.' },
  { i: 11, type: 'prop',   name: 'Cayey',          group: 'pink',   price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { i: 12, type: 'util',   name: 'LUMA Energía', price: 150, blurb: 'Rent = 4× dados (10× con las dos). La luz no está incluida.' },
  { i: 13, type: 'prop',   name: 'Aibonito',       group: 'pink',   price: 140, houseCost: 100, rents: [10, 50, 150, 450, 625, 750] },
  { i: 14, type: 'prop',   name: 'Barranquitas',   group: 'pink',   price: 160, houseCost: 100, rents: [12, 60, 180, 500, 700, 900] },
  { i: 15, type: 'rail',   name: 'Tren Urbano: Río Piedras', price: 200 },
  { i: 16, type: 'prop',   name: 'Aguadilla',      group: 'orange', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { i: 17, type: 'chest',  name: 'El Corillo' },
  { i: 18, type: 'prop',   name: 'Mayagüez',       group: 'orange', price: 180, houseCost: 100, rents: [14, 70, 200, 550, 750, 950] },
  { i: 19, type: 'prop',   name: 'Arecibo',        group: 'orange', price: 200, houseCost: 100, rents: [16, 80, 220, 600, 800, 1000] },
  { i: 20, type: 'parking', name: 'Parking Gratis', blurb: 'Un parking vacío en Plaza. Milagro navideño. (No pasa nada, es el rule oficial.)' },
  { i: 21, type: 'prop',   name: 'Caguas',         group: 'red',    price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { i: 22, type: 'chance', name: '¿Qué Pasó?' },
  { i: 23, type: 'prop',   name: 'Bayamón',        group: 'red',    price: 220, houseCost: 150, rents: [18, 90, 250, 700, 875, 1050] },
  { i: 24, type: 'prop',   name: 'Carolina',       group: 'red',    price: 240, houseCost: 150, rents: [20, 100, 300, 750, 925, 1100] },
  { i: 25, type: 'rail',   name: 'Lancha de Cataño', price: 200 },
  { i: 26, type: 'prop',   name: 'Ponce',          group: 'yellow', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { i: 27, type: 'prop',   name: 'Guaynabo',       group: 'yellow', price: 260, houseCost: 150, rents: [22, 110, 330, 800, 975, 1150] },
  { i: 28, type: 'util',   name: 'AAA Acueductos', price: 150, blurb: 'Rent = 4× dados (10× con las dos). Hierve el agua por si acaso.' },
  { i: 29, type: 'prop',   name: 'Dorado',         group: 'yellow', price: 280, houseCost: 150, rents: [24, 120, 360, 850, 1025, 1200] },
  { i: 30, type: 'gotojail', name: '¡Pa’ Dentro!', blurb: 'Directo al Oso Blanco. Sin cobrar los $200. Sin llorar.' },
  { i: 31, type: 'prop',   name: 'Santurce',       group: 'green',  price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { i: 32, type: 'prop',   name: 'Miramar',        group: 'green',  price: 300, houseCost: 200, rents: [26, 130, 390, 900, 1100, 1275] },
  { i: 33, type: 'chest',  name: 'El Corillo' },
  { i: 34, type: 'prop',   name: 'Isla Verde',     group: 'green',  price: 320, houseCost: 200, rents: [28, 150, 450, 1000, 1200, 1400] },
  { i: 35, type: 'rail',   name: 'Guagua de la AMA', price: 200 },
  { i: 36, type: 'chance', name: '¿Qué Pasó?' },
  { i: 37, type: 'prop',   name: 'Condado',        group: 'dblue',  price: 350, houseCost: 200, rents: [35, 175, 500, 1100, 1300, 1500] },
  { i: 38, type: 'tax',    name: 'Marbete de la Lexus', amount: 100, blurb: 'Lujo se paga. $100.' },
  { i: 39, type: 'prop',   name: 'Viejo San Juan', group: 'dblue',  price: 400, houseCost: 200, rents: [50, 200, 600, 1400, 1700, 2000] },
];

export const RAIL_RENTS = [25, 50, 100, 200]; // by number of rails owned
export const JAIL_POS = 10;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const START_CASH = 1500;
export const BANK_HOUSES = 32;
export const BANK_HOTELS = 12;

// Card effects (official mechanics, PR flavor):
// move {to, collectGo:true}          — advance to space, collect $200 if passing GO
// moveBack {n}                       — go back n spaces
// nearest {kind:'rail'|'util'}       — advance to nearest, pay 2x rail rent / 10x dice if owned
// money {amount}                     — +collect / -pay (bank)
// perPlayer {amount}                 — +collect from each / -pay each player
// repairs {house, hotel}             — pay per building owned
// jailFree                            — keep card
// goToJail
export const CHANCE = [
  { id: 'ch01', text: '¡El expreso está VACÍO! Nadie sabe por qué. Nadie pregunta. Avanza hasta La Salida y cobra $200.', effect: { type: 'move', to: 0, collectGo: true } },
  { id: 'ch02', text: 'Fiestas patronales en Carolina. Hay pinchos, hay bacalaítos, hay drama. Avanza a Carolina.', effect: { type: 'move', to: 24, collectGo: true } },
  { id: 'ch03', text: 'Chinchorreo guiao por la montaña. Primera parada: Cayey. Avanza (y pide el pernil).', effect: { type: 'move', to: 11, collectGo: true } },
  { id: 'ch04', text: 'Se fue la luz OTRA VEZ. Ve a la utility más cercana. Si tiene dueño, paga 10× los dados. Gracias, LUMA.', effect: { type: 'nearest', kind: 'util' } },
  { id: 'ch05', text: 'La guagua por fin llegó (solo 45 minutos tarde). Avanza al transporte más cercano; si tiene dueño paga DOBLE rent.', effect: { type: 'nearest', kind: 'rail' } },
  { id: 'ch06', text: 'Vendiste 200 limbers de coco frente a la escuela. Cobra $50, empresario.', effect: { type: 'money', amount: 50 } },
  { id: 'ch07', text: 'Tu compay es "abogado" (le falta un semestre). Igual funciona: SAL DE LA CÁRCEL GRATIS. Guarda esta tarjeta.', effect: { type: 'jailFree' } },
  { id: 'ch08', text: '"¿Apagué la estufa?" — Tú, ahora mismo. Retrocede 3 espacios a verificar.', effect: { type: 'moveBack', n: 3 } },
  { id: 'ch09', text: 'Te cogieron peleando por un parking en Plaza Las Américas. Era diciembre. Pa’l Oso Blanco directo, sin cobrar $200.', effect: { type: 'goToJail' } },
  { id: 'ch10', text: 'El huracán te voló el zinc del ranchón. Paga $25 por casa y $100 por hotel. FEMA dice que "está en proceso".', effect: { type: 'repairs', house: 25, hotel: 100 } },
  { id: 'ch11', text: 'Se te cayó el celular en la playa. El arroz no lo salvó esta vez. Paga $15.', effect: { type: 'money', amount: -15 } },
  { id: 'ch12', text: 'Viaje en el Tren Urbano a Sagrado Corazón. Sí, alguien lo usa. Tú. Hoy. (Cobra $200 si pasas por La Salida.)', effect: { type: 'move', to: 5, collectGo: true } },
  { id: 'ch13', text: 'Te invitaron a janguear al Viejo San Juan. Estacionar te va a costar el alma, pero avanza.', effect: { type: 'move', to: 39, collectGo: false } },
  { id: 'ch14', text: 'Te eligieron presidente del comité del asopao comunal. Honor grande, bolsillo chico: paga $50 a cada jugador.', effect: { type: 'perPlayer', amount: -50 } },
  { id: 'ch15', text: 'Tu GoFundMe "Un Generador Pa Mi Abuela" se llenó en 2 horas. Cobra $150. La abuela está fresh.', effect: { type: 'money', amount: 150 } },
  { id: 'ch16', text: 'Ganaste el maratón del pueblo porque los otros dos corredores se pararon a comer alcapurrias. Cobra $100.', effect: { type: 'money', amount: 100 } },
];

export const CHEST = [
  { id: 'cc01', text: 'Encontraste un shortcut sin tapón, sin hoyos y sin política. Avanza hasta La Salida y cobra $200.', effect: { type: 'move', to: 0, collectGo: true } },
  { id: 'cc02', text: 'Error del banco A TU FAVOR. Cobra $200 rapidito y actúa normal. NORMAL te dije.', effect: { type: 'money', amount: 200 } },
  { id: 'cc03', text: 'El "quiropráctico" de la marquesina te sonó la espalda. No tiene licencia pero tiene fama. Paga $50.', effect: { type: 'money', amount: -50 } },
  { id: 'cc04', text: 'Vendiste tus acciones de la empresa de piraguas de tu primo. Salió mejor que el crypto. Cobra $50.', effect: { type: 'money', amount: 50 } },
  { id: 'cc05', text: 'La abuela conoce al guardia de la cárcel desde chiquito. "Ese nene es bueno." SAL GRATIS. Guarda esta tarjeta.', effect: { type: 'jailFree' } },
  { id: 'cc06', text: 'Te colaste en la fila del Costco de Bayamón un sábado. Hay crímenes imperdonables. Pa’ dentro, sin cobrar $200.', effect: { type: 'goToJail' } },
  { id: 'cc07', text: 'Revendiste entradas del concierto de Bad Bunny. Cobra $50 de CADA jugador. El diablo trabaja duro, pero tú más.', effect: { type: 'perPlayer', amount: 50 } },
  { id: 'cc08', text: 'El coquito de la abuela se AGOTÓ antes del Día de Reyes. Receta secreta, precio no tan secreto. Cobra $100.', effect: { type: 'money', amount: 100 } },
  { id: 'cc09', text: 'Hacienda te devolvió $20 del refund. Enmárcalo, eso no pasa dos veces.', effect: { type: 'money', amount: 20 } },
  { id: 'cc10', text: '¡CUMPLEAÑOS! Te cantan el Happy Birthday, el ¡que los cumplas feliz! Y la parte que nadie se sabe. Cobra $10 de cada jugador.', effect: { type: 'perPlayer', amount: 10 } },
  { id: 'cc11', text: 'El seguro de vida de tu tío maduró. Él está vivito y jugando dominó, tranquilo. Cobra $100.', effect: { type: 'money', amount: 100 } },
  { id: 'cc12', text: 'Te picó una avispa en el chinchorro y fuiste a la sala de emergencia. Seis horas después: paga $100.', effect: { type: 'money', amount: -100 } },
  { id: 'cc13', text: 'Cuota "voluntaria" de la escuela. Voluntaria como el IVU. Paga $50.', effect: { type: 'money', amount: -50 } },
  { id: 'cc14', text: 'Le arreglaste el WiFi al vecino (lo apagaste y lo prendiste). Eres "el que sabe de computadoras". Cobra $25.', effect: { type: 'money', amount: 25 } },
  { id: 'cc15', text: 'La brigada POR FIN llegó a tapar los hoyos de tu calle. Solo tomó 7 años. Paga $40 por casa y $115 por hotel.', effect: { type: 'repairs', house: 40, hotel: 115 } },
  { id: 'cc16', text: 'Segundo lugar en el concurso de la mejor alcapurria. Perdiste contra Doña Carmen, obvio. Cobra $10.', effect: { type: 'money', amount: 10 } },
];

// Geometric tokens (rendered in the player's neon color, not emoji).
export const TOKENS = ['▲', '●', '■', '◆', '⬢', '✦', '✚', '◗'];
export const TOKEN_NAMES = {
  '▲': 'El Yunque', '●': 'La Ficha de Dominó', '■': 'El Bloque de Hielo (pa’l apagón)',
  '◆': 'El Diamante del Caribe', '⬢': 'El Panal', '✦': 'La Estrella Solitaria',
  '✚': 'La Cruz del Morro', '◗': 'La Medialuna de Pan Sobao',
};

// AI personalities. Tuning: aggro = auction/buy boldness, buildLove = building appetite,
// reserve = cash cushion the bot tries to keep.
export const PERSONALITIES = [
  {
    name: 'Doña Fela', style: 'La que guarda los chavos debajo del mattress',
    aggro: 0.8, buildLove: 0.7, reserve: 250,
    quips: {
      buy: ['Esto lo compro pa’ mis nietos.', 'En mis tiempos esto costaba 5 pesos.', 'Lo compro, pero bajo protesta.'],
      rent: ['Págame, mijo, que la novela empieza a las 7.', 'Ay bendito... pero paga.', 'Dios te bendiga. Son $%AMT%.'],
      broke: ['¡Me van a matar del corazón!', 'Esto no pasaba cuando Muñoz Marín.'],
      win: ['Se lo dije. SE LO DIJE.', 'Ahora todos me deben respeto Y dinero.'],
      auction: ['Cinco pesos más y ni uno más.', '¡Eso está más caro que la compra!'],
      jail: ['Yo conozco al alcaide, tranquilos.'],
    },
  },
  {
    name: 'Tío Bebo', style: 'Compra TODO. Preguntas después.',
    aggro: 1.35, buildLove: 1.1, reserve: 80,
    quips: {
      buy: ['¡DALE! Eso es mío.', '¿Cuánto? No importa, DALE.', 'Después me explican qué compré.'],
      rent: ['¡JA! Cae otro. Paga la renta, sobrino.', 'El que juega con fuego... me paga a mí.'],
      broke: ['Esto es un setback NADA MÁS.', '¡¿Quién cogió mis chavos?!'],
      win: ['¡WEPAAA! ¡Se acabó lo que se daba!', 'Invito a todos a comer. Pagan ustedes.'],
      auction: ['¡SUBO! ¿Qué? Yo subo siempre.', 'Eso es mío aunque me quede sin gas.'],
      jail: ['Tranquilo, aquí adentro se juega mejor dominó.'],
    },
  },
  {
    name: 'Yamilette CEO', style: 'Tiene un Excel para todo, hasta pa’l amor',
    aggro: 1.05, buildLove: 1.35, reserve: 200,
    quips: {
      buy: ['El ROI de esto es positivo. Adquirido.', 'Según mis proyecciones: mío.', 'Sinergia. Compro.'],
      rent: ['Le envío el invoice. Son $%AMT%, neto 0 días.', 'Esto está en el contrato que no leíste.'],
      broke: ['Esto es... una corrección del mercado.', 'Pivotamos. PIVOTAMOS.'],
      win: ['Q4 espectacular. Junta disuelta.', 'Lo dijo el Excel y el Excel no miente.'],
      auction: ['Mi modelo dice que vale más. Subo.', 'Outbid. Siguiente.'],
      jail: ['Esto lo resuelve mi departamento legal (mi prima).'],
    },
  },
  {
    name: 'Papo Millones', style: 'Flow de rico, cuenta de pobre',
    aggro: 1.2, buildLove: 0.9, reserve: 40,
    quips: {
      buy: ['Eso es cash, papi. Bueno... casi cash.', 'Póntelo en mi cuenta. ¿Cuál cuenta? Exacto.', 'Un rico no pregunta el precio. (¿Cuánto era?)'],
      rent: ['El lujo se paga, bebé.', 'Bienvenido a MI imperio. Son $%AMT%.'],
      broke: ['Estoy líquido... en el sentido de que me hundo.', 'Esto es temporero, mi contable está en eso.'],
      win: ['¡De Río Piedras al mundo!', 'Ahora sí somos millones, Papo.'],
      auction: ['Subo, porque el flow no se negocia.', '¿$%AMT%? Eso es un brunch pa’ mí. Subo.'],
      jail: ['La cárcel es networking si sabes mirar.'],
    },
  },
];

// Sassy log commentary
export const FLAVOR = {
  pass_go: ['%P% pasó por La Salida y cobró $200. Directito pa’l tapón de nuevo.', '%P% cobró sus $200. El IVU ya los está mirando.'],
  land_jail_visit: ['%P% está de visita en el Oso Blanco. "Vengo a ver a un amigo."'],
  go_to_jail: ['%P% cayó preso. La familia ya está haciendo el pastelón pa’ la visita.', '¡%P% pa’ dentro! El grupo de WhatsApp de la familia está EN FUEGO.'],
  jail_out_doubles: ['%P% sacó dobles y salió de la cárcel. El sistema funciona (a veces).'],
  jail_pay: ['%P% pagó $50 de fianza. Libertad con recibo.'],
  jail_card: ['%P% usó su tarjeta de "conozco a alguien". Libre.'],
  rent_paid: ['%P% pagó $%AMT% de renta a %O%. Duele más que pisar un juey.', '%P% soltó $%AMT% pa’ %O%. Se escuchó el "ay" en Vieques.'],
  bought: ['%P% compró %S% por $%AMT%. Los títeres del barrio aprueban.', '%P% se quedó con %S%. La escritura llega cuando CRIM quiera.'],
  auction_won: ['%P% ganó la subasta de %S% por $%AMT%. Remate del bueno.'],
  auction_nobody: ['Nadie quiso %S%. Ni regalao. El banco se queda con eso.'],
  tax: ['%P% pagó $%AMT% de impuestos. Hacienda dice "gracias" (mentira, no dice nada).'],
  bankrupt: ['%P% QUEBRÓ. Se va del juego como se fue la luz: sin avisar.', '%P% está en la quiebra. Capítulo 7, verso boricua.'],
  built: ['%P% construyó en %S%. Sin permisos, obviamente.', '%P% levantó construcción en %S%. El vecino ya llamó a la policía.'],
  hotel: ['%P% montó un HOTEL en %S%. Airbnb tiembla.'],
  mortgage: ['%P% hipotecó %S%. "Es un préstamo puente", dice.'],
  win: ['%P% ES DUEÑO DE LA ISLA ENTERA. Ni los fondos buitre lograron tanto.'],
};

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
