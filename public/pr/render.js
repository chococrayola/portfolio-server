/* render.js — isometric renderer.
 *
 * Draws the world in 2:1 isometric. The flat terrain (green inland + sandy
 * coast) is baked once into an offscreen canvas as raised "slabs";
 * citizens (free-thinkers + affiliated) and cities are drawn each frame
 * as little iso sprites, depth-sorted back-to-front. A smoothed camera (zoom +
 * pan) maps the iso world into the visible canvas, and screenToTile inverts the
 * projection so tap-to-inspect and god-powers land on the right tile.
 *
 * Public API (unchanged so main.js keeps working):
 *   draw, markTerrainDirty, screenToTile, zoomAtClient, zoomByCenter,
 *   panByClient, fit, focusOn, getZoom, SCALE
 */

import { COLS, ROWS, TILE, idx, isOcean, isLand, MUNI_NAMES, MUNI_ABBR } from './map.js?v=39';
import { MGRID, OCEAN_ID } from './municipios.js?v=39';

const NEUTRAL = '#9aa6b2'; // color for unclaimed cities / free-thinkers
const ABBR_BY_NAME = {};
for (let i = 0; i < MUNI_NAMES.length; i++) ABBR_BY_NAME[MUNI_NAMES[i]] = MUNI_ABBR[i];

// --- Isometric tile metrics ----------------------------------------------
const TW = 14;          // tile width in world px
const TH = TW / 2;      // tile height (2:1 iso)
const EH = TW / 4;      // px per elevation unit
const SLAB = 2.4;       // land base thickness (coastal cliff height, in units)
const MAXELEV = SLAB + 2.6; // reserve vertical room (so volcanoes never clip)
const HW = TW / 2, HH = TH / 2;
const SCALE = TW;       // exported for compatibility

function elevOf(t) {
  switch (t) {
    case TILE.OCEAN: return 0;
    case TILE.BEACH: return SLAB + 0.0;
    case TILE.GRASS: return SLAB + 0.25;
    case TILE.HILL: return SLAB + 1.1;
    case TILE.MOUNTAIN: return SLAB + 2.3;
    case TILE.FOREST: return SLAB + 0.6;
    case TILE.URBAN: return SLAB + 0.35;
    default: return SLAB;
  }
}
const TOP = {
  [TILE.BEACH]: '#efdca0', [TILE.GRASS]: '#7cc24f', [TILE.HILL]: '#5b9a3d',
  [TILE.MOUNTAIN]: '#9a8b73', [TILE.FOREST]: '#2f7a3a', [TILE.URBAN]: '#b9bfc5',
};
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r * f)) | 0;
  g = Math.max(0, Math.min(255, g * f)) | 0;
  b = Math.max(0, Math.min(255, b * f)) | 0;
  return `rgb(${r},${g},${b})`;
}

export function createRenderer(canvas, world) {
  // World-space iso coordinates (before the origin offset).
  const isoX = (x, y) => (x - y) * HW;
  const isoY = (x, y, e) => (x + y) * HH - e * EH;

  // ---- Iso world bounds → canvas size + origin --------------------------
  let originX = 0, originY = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isLand(world.tiles[idx(x, y)])) continue;
      const sx = isoX(x, y);
      const sTop = isoY(x, y, MAXELEV); // reserve room for tall peaks
      const sBot = isoY(x, y, 0) + TH;
      if (sx - HW < minX) minX = sx - HW;
      if (sx + HW > maxX) maxX = sx + HW;
      if (sTop - HH < minY) minY = sTop - HH;
      if (sBot > maxY) maxY = sBot;
    }
  }
  if (!isFinite(minX)) { minX = 0; maxX = COLS * HW; minY = 0; maxY = ROWS * HH; }
  const PAD = 80;
  const W = (canvas.width = Math.ceil(maxX - minX) + PAD * 2);
  const H = (canvas.height = Math.ceil(maxY - minY) + PAD * 2);
  originX = -minX + PAD;
  originY = -minY + PAD;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Screen anchor (top-center of a tile's top diamond, at its elevation).
  function anchor(x, y) {
    const t = world.tiles[idx(x, y)];
    const e = isLand(t) ? elevOf(t) : 0;
    return { sx: originX + isoX(x, y), sy: originY + isoY(x, y, e) };
  }
  // ---- Camera (smoothed) ------------------------------------------------
  let zoom = 1, panX = 0, panY = 0;
  let zT = 1, pTx = 0, pTy = 0;
  const MIN_ZOOM = 0.4, MAX_ZOOM = 8;
  function clampTarget() {
    if (zT <= 1) { pTx = (W - W * zT) / 2; pTy = (H - H * zT) / 2; }
    else {
      pTx = Math.min(0, Math.max(W * (1 - zT), pTx));
      pTy = Math.min(0, Math.max(H * (1 - zT), pTy));
    }
  }
  function easeCamera() {
    const e = 0.28;
    zoom += (zT - zoom) * e;
    panX += (pTx - panX) * e;
    panY += (pTy - panY) * e;
    if (Math.abs(zT - zoom) < 0.002) zoom = zT;
    if (Math.abs(pTx - panX) < 0.3) panX = pTx;
    if (Math.abs(pTy - panY) < 0.3) panY = pTy;
  }
  function clientToCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }
  // Inverse iso projection. Picks at the land base elevation (SLAB) since that
  // is where almost everything the player taps lives; tall peaks are slightly
  // off but close enough for selection / power placement.
  function screenToTile(clientX, clientY) {
    const c = clientToCanvas(clientX, clientY);
    const wx = (c.x - panX) / zoom - originX;
    const wy = (c.y - panY) / zoom - originY + SLAB * EH;
    const fx = wx / TW + wy / TH;
    const fy = wy / TH - wx / TW;
    return { x: Math.floor(fx), y: Math.floor(fy) };
  }
  function zoomAtClient(clientX, clientY, factor) {
    const c = clientToCanvas(clientX, clientY);
    const wx = (c.x - pTx) / zT, wy = (c.y - pTy) / zT;
    zT = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zT * factor));
    pTx = c.x - wx * zT; pTy = c.y - wy * zT;
    clampTarget();
  }
  function panByClient(dx, dy) {
    const r = canvas.getBoundingClientRect();
    pTx += (dx / r.width) * W; pTy += (dy / r.height) * H;
    clampTarget();
  }
  function zoomByCenter(factor) {
    const cxp = W / 2, cyp = H / 2;
    const wx = (cxp - pTx) / zT, wy = (cyp - pTy) / zT;
    zT = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zT * factor));
    pTx = cxp - wx * zT; pTy = cyp - wy * zT;
    clampTarget();
  }
  function fit() { zT = 1; pTx = 0; pTy = 0; }
  function getZoom() { return zoom; }
  function focusOn(tx, ty, z) {
    zT = Math.max(z || 3, MIN_ZOOM);
    const a = anchor(tx, ty);
    pTx = W / 2 - a.sx * zT; pTy = H / 2 - a.sy * zT;
    clampTarget();
  }

  // ---- Terrain bake (iso slabs) -----------------------------------------
  const terrain = document.createElement('canvas');
  terrain.width = W; terrain.height = H;
  const tctx = terrain.getContext('2d');
  let terrainDirty = true;

  function bakeTile(d, x, y) {
    const t = world.tiles[idx(x, y)];
    if (!isLand(t)) return;
    const e = elevOf(t);
    const cx = originX + isoX(x, y);
    const topY = originY + isoY(x, y, e);
    const baseY = originY + isoY(x, y, 0) + TH;
    const top = TOP[t] || '#7cc24f';
    const j = ((x * 53 + y * 131) % 7) / 100 - 0.03; // per-tile jitter
    // left face
    d.fillStyle = shade(top, 0.6 + j);
    d.beginPath();
    d.moveTo(cx - HW, topY); d.lineTo(cx, topY + HH);
    d.lineTo(cx, baseY); d.lineTo(cx - HW, baseY - HH);
    d.closePath(); d.fill();
    // right face
    d.fillStyle = shade(top, 0.78 + j);
    d.beginPath();
    d.moveTo(cx + HW, topY); d.lineTo(cx, topY + HH);
    d.lineTo(cx, baseY); d.lineTo(cx + HW, baseY - HH);
    d.closePath(); d.fill();
    // top diamond
    d.fillStyle = shade(top, 1.0 + j);
    d.beginPath();
    d.moveTo(cx, topY - HH); d.lineTo(cx + HW, topY);
    d.lineTo(cx, topY + HH); d.lineTo(cx - HW, topY);
    d.closePath(); d.fill();
    // decorations
    if (t === TILE.MOUNTAIN && ((x * 31 + y * 17) % 5) < 2) {
      d.fillStyle = '#f4f6fb';
      d.beginPath();
      d.moveTo(cx, topY - HH * 0.5); d.lineTo(cx + HW * 0.32, topY);
      d.lineTo(cx - HW * 0.32, topY); d.closePath(); d.fill();
    } else if (t === TILE.FOREST) {
      d.fillStyle = '#1c5a26';
      d.beginPath();
      d.moveTo(cx, topY - TH * 1.0); d.lineTo(cx + HW * 0.4, topY - HH * 0.1);
      d.lineTo(cx - HW * 0.4, topY - HH * 0.1); d.closePath(); d.fill();
    } else if (t === TILE.URBAN) {
      d.fillStyle = 'rgba(255,255,255,0.18)';
      d.fillRect(cx - HW * 0.3, topY - HH * 0.2, HW * 0.6, HH * 0.4);
    }
  }

  // Municipio boundary lines ("city dividers"): draw the shared top-diamond edge
  // between any two land tiles that belong to different municipios. Drawn after
  // all slabs so the lines sit on top of the terrain.
  function bakeBorders(d) {
    d.save();
    d.lineWidth = 1;
    d.lineCap = 'round';
    d.strokeStyle = 'rgba(16,24,34,0.55)';
    d.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const here = MGRID[idx(x, y)];
        if (here === OCEAN_ID) continue;
        const e = elevOf(world.tiles[idx(x, y)]);
        const cx = originX + isoX(x, y);
        const topY = originY + isoY(x, y, e);
        if (x + 1 < COLS) {
          const nb = MGRID[idx(x + 1, y)];
          if (nb !== OCEAN_ID && nb !== here) { d.moveTo(cx + HW, topY); d.lineTo(cx, topY + HH); }
        }
        if (y + 1 < ROWS) {
          const nb = MGRID[idx(x, y + 1)];
          if (nb !== OCEAN_ID && nb !== here) { d.moveTo(cx - HW, topY); d.lineTo(cx, topY + HH); }
        }
      }
    }
    d.stroke();
    d.restore();
  }

  function bakeTerrain() {
    tctx.clearRect(0, 0, W, H);
    for (let s = 0; s <= COLS + ROWS - 2; s++) {
      const xMin = Math.max(0, s - (ROWS - 1));
      const xMax = Math.min(COLS - 1, s);
      for (let x = xMin; x <= xMax; x++) bakeTile(tctx, x, s - x);
    }
    bakeBorders(tctx);
  }

  // ---- Sprites ----------------------------------------------------------
  function drawPerson(sx, sy, color, colorDark, opt) {
    const o = opt || {};
    let s = TW * (o.leader ? 0.52 : o.free ? 0.34 : 0.38);
    if (o.old) { s *= 0.85; ctx.globalAlpha = 0.6; } // elders are smaller / fainter
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(sx, sy, s * 0.5, s * 0.24, 0, 0, 7); ctx.fill();
    if (o.onSea) {
      ctx.fillStyle = '#6b4423';
      ctx.beginPath();
      ctx.moveTo(sx - s * 0.7, sy - s * 0.1);
      ctx.lineTo(sx + s * 0.7, sy - s * 0.1);
      ctx.lineTo(sx + s * 0.45, sy + s * 0.28);
      ctx.lineTo(sx - s * 0.45, sy + s * 0.28);
      ctx.closePath(); ctx.fill();
    }
    const bob = ((world.tick + (o.id || 0)) >> 2) & 1;
    const footY = sy - (o.onSea ? s * 0.05 : 0) - bob;
    // body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(sx - s * 0.3, footY - s * 0.95, s * 0.6, s * 0.85, s * 0.18);
    ctx.fill();
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath(); ctx.arc(sx, footY - s * 1.08, s * 0.28, 0, 7); ctx.fill();
    if (o.leader) {
      // gold halo + crown
      ctx.fillStyle = 'rgba(255,211,77,0.32)';
      ctx.beginPath(); ctx.ellipse(sx, footY - s * 0.4, s * 0.95, s * 0.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd34d';
      const w = s * 0.56, cyq = footY - s * 1.42;
      ctx.beginPath();
      ctx.moveTo(sx - w / 2, cyq);
      ctx.lineTo(sx - w / 2, cyq - s * 0.26);
      ctx.lineTo(sx - w / 4, cyq - s * 0.06);
      ctx.lineTo(sx, cyq - s * 0.32);
      ctx.lineTo(sx + w / 4, cyq - s * 0.06);
      ctx.lineTo(sx + w / 2, cyq - s * 0.26);
      ctx.lineTo(sx + w / 2, cyq);
      ctx.closePath(); ctx.fill();
    } else if (o.deputy) {
      // small star badge over the head
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(sx - s * 0.12, footY - s * 1.5, s * 0.24, s * 0.24);
    }
    ctx.globalAlpha = 1;
  }

  function drawDot(sx, sy, color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(sx - r, sy - r * 1.2, r * 2, r * 2);
  }

  function drawCity(c, sx, sy) {
    const owned = c.owner >= 0;
    const civ = owned ? world.civs[c.owner] : null;
    const col = owned ? civ.color : NEUTRAL;
    const colDark = owned ? (civ.colorDark || civ.color) : '#6c7782';
    // La torre crece con la población del pueblo (más ciudadanos → más alta/grande).
    const pop = c.pop || 0;
    const grow = Math.min(1.9, Math.sqrt(pop) / 5); // 0 → ~0; 25 → 1.0; 90 → 1.9 (tope)
    const s = TW * (1.0 + grow);
    const big = pop > 40; // bandera en los pueblos más poblados
    const flash = c.flash > 0 ? c.flash / 45 : 0;
    // ownership ring / claim flash
    ctx.fillStyle = col;
    ctx.globalAlpha = (owned ? 0.18 : 0.10) + flash * 0.5;
    ctx.beginPath(); ctx.ellipse(sx, sy, s * (0.8 + flash * 0.6), s * 0.45 + flash * s * 0.3, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    // iso building: left + right wall + roof (the "pin")
    const h = s * 0.95, bw = s * 0.5, topY = sy - h;
    ctx.fillStyle = colDark;
    ctx.beginPath();
    ctx.moveTo(sx - bw, sy - bw * 0.5); ctx.lineTo(sx, sy); ctx.lineTo(sx, topY); ctx.lineTo(sx - bw, topY - bw * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, 0.85);
    ctx.beginPath();
    ctx.moveTo(sx + bw, sy - bw * 0.5); ctx.lineTo(sx, sy); ctx.lineTo(sx, topY); ctx.lineTo(sx + bw, topY - bw * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(sx, topY - bw); ctx.lineTo(sx + bw, topY - bw * 0.5); ctx.lineTo(sx, topY); ctx.lineTo(sx - bw, topY - bw * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(sx + bw * 0.25, sy - bw * 0.55, bw * 0.3, bw * 0.55);
    if (big) { // flag on bigger cities
      ctx.fillStyle = '#fff'; ctx.fillRect(sx - 0.5, topY - bw * 0.5 - s * 0.5, 1, s * 0.5);
      ctx.fillStyle = col; ctx.fillRect(sx, topY - bw * 0.5 - s * 0.5, s * 0.32, s * 0.18);
    }
  }

  // City name label (drawn after all buildings; fades in when zoomed in).
  function drawCityLabel(c, sx, sy) {
    const owned = c.owner >= 0;
    const label = ABBR_BY_NAME[c.muni] || c.name;
    const fs = Math.max(5, TW * 0.62);
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const ly = sy - TW * 1.7;
    ctx.lineWidth = Math.max(1.5, fs * 0.32);
    ctx.strokeStyle = 'rgba(8,14,22,0.92)';
    ctx.strokeText(label, sx, ly);
    ctx.fillStyle = owned ? world.civs[c.owner].color : '#e7eef5';
    ctx.fillText(label, sx, ly);
  }

  // ---- Frame ------------------------------------------------------------
  function draw() {
    if (terrainDirty) { bakeTerrain(); terrainDirty = false; }
    easeCamera();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // ocean background (subtle vertical gradient)
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1f6da0'); g.addColorStop(1, '#0c3350');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
    ctx.drawImage(terrain, 0, 0);

    const detailed = zoom >= 0.9;
    // Collect ground entities and depth-sort (back → front).
    const ents = [];
    for (const c of world.citizens) ents.push({ d: c.x + c.y + (c.isLeader ? 0.35 : 0.1), k: 2, o: c });
    for (const c of world.cities) ents.push({ d: c.x + c.y + 0.25, k: 3, o: c });
    ents.sort((p, q) => p.d - q.d);

    for (const e of ents) {
      const o = e.o;
      const ax = anchor(o.x, o.y);
      if (e.k === 2) { // citizen (free-thinker or affiliated)
        const free = o.party < 0;
        const civ = free ? null : world.civs[o.party];
        const color = free ? NEUTRAL : civ.color;
        const colorDark = free ? '#7a828c' : (civ.colorDark || civ.color);
        const old = o.age > o.maxAge * 0.72;
        if (detailed || o.isLeader) {
          drawPerson(ax.sx, ax.sy, color, colorDark, { leader: o.isLeader, deputy: o.isDeputy, free, old, id: o.id });
        } else {
          drawDot(ax.sx, ax.sy, color, TW * (free ? 0.11 : 0.14));
        }
      } else { // city
        drawCity(o, ax.sx, ax.sy);
      }
    }

    // City name labels on top (owned ones earlier, all when zoomed in).
    if (zoom >= 0.85) {
      for (const city of world.cities) {
        if (city.owner < 0 && zoom < 1.4) continue;
        const ax = anchor(city.x, city.y);
        drawCityLabel(city, ax.sx, ax.sy);
      }
    }
  }

  function markTerrainDirty() { terrainDirty = true; }

  return { draw, markTerrainDirty, screenToTile, zoomAtClient, zoomByCenter, panByClient, fit, focusOn, getZoom, SCALE };
}
