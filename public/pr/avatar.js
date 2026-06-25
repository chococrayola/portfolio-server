/* avatar.js — retratos pixel-art generados por código (originales).
 *
 * Cada personaje obtiene una carita determinista a partir de una semilla
 * (su nombre/id), así que la misma persona siempre se ve igual. No se usan
 * fotos reales — todo es pixel-art procedural.
 */

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFromString(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return mulberry32(h);
}

const SKINS = ['#ffe0bd', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
const HAIRS = ['#1a120b', '#3a2415', '#000000', '#5b3a1e', '#7a7a7a', '#b5651a', '#d9c27a'];

const cache = new Map();

/**
 * Devuelve un data URL (PNG) con una carita de 8×8 escalada.
 * @param {string} seed  semilla estable (nombre/id)
 * @param {string} accent  color de la "camisa" (color del partido)
 * @param {object} [opts] { size, bg, crown }
 */
export function avatarDataURL(seed, accent, opts = {}) {
  const key = seed + '|' + accent + '|' + (opts.crown ? 'c' : '') + (opts.size || 48) + (opts.bg || '');
  if (cache.has(key)) return cache.get(key);

  const R = rngFromString(seed);
  const px = opts.size || 48;
  const G = 8;
  const cell = px / G;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;

  const skin = SKINS[(R() * SKINS.length) | 0];
  const hair = HAIRS[(R() * HAIRS.length) | 0];

  c.fillStyle = opts.bg || '#14222e';
  c.fillRect(0, 0, px, px);
  const fill = (x, y, col) => { c.fillStyle = col; c.fillRect(x * cell, y * cell, cell + 0.6, cell + 0.6); };

  // cara (piel)
  for (let y = 2; y < 7; y++) for (let x = 1; x < 7; x++) fill(x, y, skin);
  // pelo arriba (con flequillo variable)
  const hairLow = 1 + (R() < 0.5 ? 1 : 0);
  for (let y = 1; y <= hairLow; y++) for (let x = 1; x < 7; x++) fill(x, y, hair);
  if (R() < 0.5) { fill(1, 3, hair); fill(6, 3, hair); } // patillas
  // ojos
  fill(2, 4, '#1b1b1b'); fill(5, 4, '#1b1b1b');
  if (R() < 0.3) { // gafas
    fill(2, 4, '#dfe7ee'); fill(5, 4, '#dfe7ee'); fill(3, 4, '#9aa6b2'); fill(4, 4, '#9aa6b2');
  }
  // boca / barba
  if (R() < 0.25) { for (let x = 2; x < 6; x++) fill(x, 5, hair); fill(3, 6, '#7a3b3b'); }
  else { fill(3, 6, '#7a3b3b'); if (R() < 0.5) fill(4, 6, '#7a3b3b'); }
  // camisa del color del partido
  for (let x = 1; x < 7; x++) fill(x, 7, accent);
  // corona para líderes
  if (opts.crown) {
    c.fillStyle = '#ffd34d';
    c.beginPath();
    const w = 5 * cell, x0 = 1.5 * cell, yb = 1.2 * cell, yt = 0.1 * cell;
    c.moveTo(x0, yb); c.lineTo(x0, yt); c.lineTo(x0 + w * 0.25, yt + (yb - yt) * 0.5);
    c.lineTo(x0 + w * 0.5, yt); c.lineTo(x0 + w * 0.75, yt + (yb - yt) * 0.5);
    c.lineTo(x0 + w, yt); c.lineTo(x0 + w, yb); c.closePath(); c.fill();
  }

  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
