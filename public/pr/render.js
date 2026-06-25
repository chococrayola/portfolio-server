/* render.js — draws the world to a canvas with crisp pixel scaling, a zoomable
 * camera, and WorldBox-flavored pixel sprites.
 *
 * Layers (bottom→top): terrain (cached) → territory fill (cached) → terrain
 * detail (trees/peaks/waves, cached) → municipio borders+labels (cached) →
 * units (little people) → animals → cities (buildings) → live effects
 * (dragon/UFO/tornado/volcano). Everything is drawn in "world pixels" under a
 * camera transform so pinch-zoom stays crisp.
 */

import { COLS, ROWS, TILE, TILE_COLOR, idx, isOcean, MUNI_ABBR, MUNI_CENTROIDS } from './map.js?v=17';
import { MGRID, OCEAN_ID } from './municipios.js?v=17';

const SCALE = 8; // world pixels per tile (mapa más grande)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hash(x, y) {
  const n = Math.sin(x * 53.7 + y * 19.3) * 43758.5453;
  return n - Math.floor(n);
}

export function createRenderer(canvas, world) {
  const W = (canvas.width = COLS * SCALE);
  const H = (canvas.height = ROWS * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---- Camera -----------------------------------------------------------
  let zoom = 1, panX = 0, panY = 0;
  function clampPan() {
    if (zoom <= 1) { // zoomed out: center the map with margin around it
      panX = (W - W * zoom) / 2;
      panY = (H - H * zoom) / 2;
    } else {
      panX = Math.min(0, Math.max(W * (1 - zoom), panX));
      panY = Math.min(0, Math.max(H * (1 - zoom), panY));
    }
  }
  const MIN_ZOOM = 0.5;
  function clientToCanvas(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }
  function screenToTile(clientX, clientY) {
    const c = clientToCanvas(clientX, clientY);
    return { x: Math.floor((c.x - panX) / zoom / SCALE), y: Math.floor((c.y - panY) / zoom / SCALE) };
  }
  function zoomAtClient(clientX, clientY, factor) {
    const c = clientToCanvas(clientX, clientY);
    const wx = (c.x - panX) / zoom, wy = (c.y - panY) / zoom;
    zoom = Math.max(MIN_ZOOM, Math.min(8, zoom * factor));
    panX = c.x - wx * zoom; panY = c.y - wy * zoom;
    clampPan();
  }
  function panByClient(dx, dy) {
    const r = canvas.getBoundingClientRect();
    panX += (dx / r.width) * W; panY += (dy / r.height) * H;
    clampPan();
  }
  function zoomByCenter(factor) {
    const cxp = W / 2, cyp = H / 2;
    const wx = (cxp - panX) / zoom, wy = (cyp - panY) / zoom;
    zoom = Math.max(MIN_ZOOM, Math.min(8, zoom * factor));
    panX = cxp - wx * zoom; panY = cyp - wy * zoom;
    clampPan();
  }
  function fit() { zoom = 1; panX = 0; panY = 0; }
  function getZoom() { return zoom; }

  // ---- Offscreen 1px/tile layers ---------------------------------------
  const terrain = document.createElement('canvas');
  terrain.width = COLS; terrain.height = ROWS;
  const tctx = terrain.getContext('2d');
  const terrainImg = tctx.createImageData(COLS, ROWS);

  const terr = document.createElement('canvas');
  terr.width = COLS; terr.height = ROWS;
  const terrCtx = terr.getContext('2d');
  const terrImg = terrCtx.createImageData(COLS, ROWS);

  // Full-res cached layers (detail + municipio overlay).
  const detail = document.createElement('canvas');
  detail.width = W; detail.height = H;
  const muni = document.createElement('canvas');
  muni.width = W; muni.height = H;

  const civRgb = world.civs.map((c) => hexToRgb(c.color));
  const tileRgb = {};
  for (const k of Object.keys(TILE_COLOR)) tileRgb[k] = hexToRgb(TILE_COLOR[k]);

  let terrainDirty = true;

  function buildTerrain() {
    const d = terrainImg.data;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        const [r, g, b] = tileRgb[world.tiles[i]];
        const j = ((hash(x + 3, y + 7) * 22) | 0) - 11; // shade jitter for texture
        const p = i * 4;
        d[p] = Math.max(0, Math.min(255, r + j));
        d[p + 1] = Math.max(0, Math.min(255, g + j));
        d[p + 2] = Math.max(0, Math.min(255, b + j));
        d[p + 3] = 255;
      }
    }
    tctx.putImageData(terrainImg, 0, 0);
  }

  function drawTree(d, cx, by, r) {
    d.fillStyle = '#5a3a1e';
    d.fillRect(cx - 0.5, by - r * 0.3, 1.2, r * 0.6);
    d.fillStyle = '#246b2a';
    d.beginPath();
    d.moveTo(cx, by - r);
    d.lineTo(cx - r * 0.65, by);
    d.lineTo(cx + r * 0.65, by);
    d.closePath();
    d.fill();
  }

  function buildDetail() {
    const d = detail.getContext('2d');
    d.clearRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tl = world.tiles[idx(x, y)];
        const px = x * SCALE, py = y * SCALE;
        const h = hash(x, y);
        if (tl === TILE.FOREST) {
          drawTree(d, px + SCALE * 0.32, py + SCALE * 0.7, SCALE * 0.55);
          if (h > 0.45) drawTree(d, px + SCALE * 0.72, py + SCALE * 0.5, SCALE * 0.48);
        } else if (tl === TILE.MOUNTAIN) {
          d.fillStyle = '#6e604e';
          d.beginPath();
          d.moveTo(px, py + SCALE);
          d.lineTo(px + SCALE / 2, py + SCALE * 0.12);
          d.lineTo(px + SCALE, py + SCALE);
          d.closePath();
          d.fill();
          d.fillStyle = '#e3ddd0';
          d.beginPath();
          d.moveTo(px + SCALE * 0.36, py + SCALE * 0.46);
          d.lineTo(px + SCALE / 2, py + SCALE * 0.12);
          d.lineTo(px + SCALE * 0.64, py + SCALE * 0.46);
          d.closePath();
          d.fill();
        } else if (tl === TILE.HILL) {
          if (h > 0.62) { d.fillStyle = 'rgba(0,0,0,0.10)'; d.fillRect(px + SCALE * 0.3, py + SCALE * 0.5, SCALE * 0.4, SCALE * 0.3); }
        } else if (tl === TILE.OCEAN) {
          if (h > 0.88) { d.fillStyle = 'rgba(255,255,255,0.16)'; d.fillRect(px + 1, py + SCALE * 0.5, SCALE * 0.6, 1); }
        }
      }
    }
  }

  // Static municipio borders + abbreviated labels.
  (function buildMuni() {
    const o = muni.getContext('2d');
    o.strokeStyle = 'rgba(15,23,32,0.5)';
    o.lineWidth = 1;
    o.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const a = MGRID[idx(x, y)];
        if (a === OCEAN_ID) continue;
        if (x + 1 < COLS) {
          const b = MGRID[idx(x + 1, y)];
          if (b !== OCEAN_ID && b !== a) { o.moveTo((x + 1) * SCALE + 0.5, y * SCALE); o.lineTo((x + 1) * SCALE + 0.5, (y + 1) * SCALE); }
        }
        if (y + 1 < ROWS) {
          const b = MGRID[idx(x, y + 1)];
          if (b !== OCEAN_ID && b !== a) { o.moveTo(x * SCALE, (y + 1) * SCALE + 0.5); o.lineTo((x + 1) * SCALE, (y + 1) * SCALE + 0.5); }
        }
      }
    }
    o.stroke();
    o.font = `bold ${Math.round(SCALE * 1.5)}px system-ui, sans-serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.lineWidth = 2.5;
    o.strokeStyle = 'rgba(10,16,24,0.85)';
    o.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < MUNI_ABBR.length; i++) {
      const c = MUNI_CENTROIDS[i];
      const px = c[0] * SCALE + SCALE / 2, py = c[1] * SCALE + SCALE / 2;
      o.strokeText(MUNI_ABBR[i], px, py);
      o.fillText(MUNI_ABBR[i], px, py);
    }
  })();

  function buildTerritory() {
    const d = terrImg.data;
    const owner = world.owner;
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i];
      const p = i * 4;
      if (o < 0 || isOcean(world.tiles[i])) { d[p + 3] = 0; }
      else { const [r, g, b] = civRgb[o]; d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 115; }
    }
    terrCtx.putImageData(terrImg, 0, 0);
  }

  // ---- Sprites ----------------------------------------------------------
  function drawUnits(detailed) {
    for (const u of world.units) {
      const c = world.civs[u.civ];
      const px = u.x * SCALE, py = u.y * SCALE;
      const onSea = isOcean(world.tiles[idx(u.x, u.y)]);
      if (!detailed) {
        ctx.fillStyle = c.color;
        ctx.fillRect(px + SCALE * 0.2, py + SCALE * 0.2, SCALE * 0.6, SCALE * 0.6);
        if (onSea) { ctx.fillStyle = '#6b4423'; ctx.fillRect(px + SCALE * 0.1, py + SCALE * 0.7, SCALE * 0.8, SCALE * 0.25); }
        continue;
      }
      const bob = ((world.tick + u.id) >> 2) & 1;
      const cx = px + SCALE / 2, top = py + 0.3 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; // contorno
      ctx.fillRect(cx - 2, top, 4, SCALE);
      ctx.fillStyle = '#f1c27d'; // cabeza (piel)
      ctx.fillRect(cx - 1.5, top, 3, 2.2);
      ctx.fillStyle = c.color; // cuerpo (color del partido)
      ctx.fillRect(cx - 1.5, top + 2.2, 3, SCALE - 3.6);
      if (onSea) {
        // bote bajo el personaje en el mar
        ctx.fillStyle = '#6b4423';
        ctx.beginPath();
        ctx.moveTo(px + 0.5, py + SCALE - 2.5);
        ctx.lineTo(px + SCALE - 0.5, py + SCALE - 2.5);
        ctx.lineTo(px + SCALE - 2, py + SCALE - 0.3);
        ctx.lineTo(px + 2, py + SCALE - 0.3);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = c.colorDark || c.color; // piernas
        ctx.fillRect(cx - 1.5, top + SCALE - 1.6, 1.3, 1.6);
        ctx.fillRect(cx + 0.2, top + SCALE - 1.6, 1.3, 1.6);
      }
    }
  }

  function drawFree(detailed) {
    if (!world.free) return;
    for (const f of world.free) {
      const px = f.x * SCALE, py = f.y * SCALE, cx = px + SCALE / 2;
      if (!detailed) {
        ctx.fillStyle = '#b9c2cc';
        ctx.fillRect(px + SCALE * 0.3, py + SCALE * 0.3, SCALE * 0.4, SCALE * 0.4);
        continue;
      }
      const top = py + 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(cx - 1.6, top, 3.2, SCALE - 0.5);
      ctx.fillStyle = '#c2cbd4';
      ctx.fillRect(cx - 1.2, top + 2, 2.4, SCALE - 2.5);
      ctx.fillStyle = '#9aa6b2';
      ctx.fillRect(cx - 1.2, top, 2.4, 2);
    }
  }

  function drawAnimals(detailed) {
    for (const a of world.animals) {
      const px = a.x * SCALE, py = a.y * SCALE, cx = px + SCALE / 2, cy = py + SCALE / 2;
      if (a.type === 3) { // bird
        ctx.fillStyle = '#1c1c1c';
        ctx.fillRect(cx - 1, cy - 0.5, 2, 1);
        continue;
      }
      if (a.type === 2) { // fish
        ctx.fillStyle = '#bfe9ff';
        ctx.fillRect(cx - 1, cy, 2, 1);
        continue;
      }
      if (!detailed) {
        ctx.fillStyle = a.type === 1 ? '#5a5a5a' : '#f1f1ee';
        ctx.fillRect(cx - 1, cy - 1, 2.2, 2.2);
        continue;
      }
      if (a.type === 1) { // wolf
        ctx.fillStyle = '#555a5e';
        ctx.fillRect(cx - 2, cy - 1, 4, 2.5);
        ctx.fillRect(cx + 1.5, cy - 1.5, 1.5, 1.5);
      } else { // sheep
        ctx.fillStyle = '#f2f2ee';
        ctx.fillRect(cx - 2, cy - 1.5, 4, 3);
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(cx + 1.5, cy - 1, 1.5, 1.5);
      }
    }
  }

  function drawLeaders() {
    for (const u of world.units) {
      if (!u.isLeader) continue;
      const px = u.x * SCALE, py = u.y * SCALE, cx = px + SCALE / 2;
      // gold halo so rulers are findable even when zoomed out
      ctx.fillStyle = 'rgba(255,211,77,0.35)';
      ctx.beginPath(); ctx.arc(cx, py + SCALE / 2, SCALE * 0.9, 0, 7); ctx.fill();
      // crown above the head
      const w = SCALE * 0.9, h = SCALE * 0.6, x0 = cx - w / 2, yb = py - 1, yt = yb - h;
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(x0, yb);
      ctx.lineTo(x0, yt);
      ctx.lineTo(x0 + w * 0.25, yt + h * 0.5);
      ctx.lineTo(cx, yt);
      ctx.lineTo(x0 + w * 0.75, yt + h * 0.5);
      ctx.lineTo(x0 + w, yt);
      ctx.lineTo(x0 + w, yb);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 0.4; ctx.stroke();
    }
  }

  function drawCities() {
    for (const c of world.cities) {
      const civ = world.civs[c.civ];
      const big = c.pop > 20;
      const s = SCALE * (big ? 1.9 : 1.3);
      const px = c.x * SCALE + SCALE / 2, py = c.y * SCALE + SCALE / 2;
      const x0 = px - s / 2, y0 = py - s / 2;
      ctx.fillStyle = civ.colorDark;
      ctx.fillRect(x0, y0 + s * 0.42, s, s * 0.58);
      ctx.fillStyle = civ.color; // roof
      ctx.beginPath();
      ctx.moveTo(x0 - 1, y0 + s * 0.46);
      ctx.lineTo(px, y0);
      ctx.lineTo(x0 + s + 1, y0 + s * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; // door
      ctx.fillRect(px - s * 0.12, y0 + s * 0.62, s * 0.24, s * 0.38);
      if (big) { // capital flag
        ctx.fillStyle = '#fff'; ctx.fillRect(px - 0.5, y0 - s * 0.4, 1, s * 0.4);
        ctx.fillStyle = civ.color; ctx.fillRect(px, y0 - s * 0.4, s * 0.35, s * 0.18);
      }
      if (c.hp < c.maxHp) {
        const w = s;
        ctx.fillStyle = '#000'; ctx.fillRect(px - w / 2, y0 - 3, w, 2);
        ctx.fillStyle = '#3fd96b'; ctx.fillRect(px - w / 2, y0 - 3, w * (c.hp / c.maxHp), 2);
      }
    }
  }

  function drawEffects() {
    for (const e of world.effects) {
      const px = e.x * SCALE, py = e.y * SCALE;
      if (e.kind === 'dragon') {
        ctx.fillStyle = '#a83246';
        ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px - 13, py - 7); ctx.lineTo(px - 3, py - 3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(px + 3, py); ctx.lineTo(px + 13, py - 7); ctx.lineTo(px + 3, py - 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a1f2b'; ctx.fillRect(px - 4, py - 3, 9, 6);
        // fire breath toward target
        ctx.fillStyle = 'rgba(255,140,0,0.85)';
        const fx = e.tx * SCALE, fy = e.ty * SCALE;
        ctx.beginPath(); ctx.arc(fx, fy, SCALE * 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,220,80,0.8)';
        ctx.beginPath(); ctx.arc(fx, fy, SCALE * 0.8, 0, 7); ctx.fill();
      } else if (e.kind === 'ufo') {
        ctx.fillStyle = 'rgba(140,255,160,0.25)'; // beam
        ctx.beginPath(); ctx.moveTo(px - 2, py); ctx.lineTo(px + 2, py); ctx.lineTo(px + 7, py + SCALE * 3); ctx.lineTo(px - 7, py + SCALE * 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#9aa6b2'; ctx.beginPath(); ctx.ellipse(px, py, SCALE * 1.6, SCALE * 0.7, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#cfe8ff'; ctx.beginPath(); ctx.ellipse(px, py - SCALE * 0.4, SCALE * 0.7, SCALE * 0.5, 0, 0, 7); ctx.fill();
      } else if (e.kind === 'tornado') {
        ctx.fillStyle = 'rgba(90,90,90,0.7)';
        const wob = Math.sin(e.t * 0.5) * 2;
        ctx.beginPath();
        ctx.moveTo(px - SCALE * 1.6 + wob, py - SCALE * 2.2);
        ctx.lineTo(px + SCALE * 1.6 + wob, py - SCALE * 2.2);
        ctx.lineTo(px + 1, py + SCALE);
        ctx.lineTo(px - 1, py + SCALE);
        ctx.closePath(); ctx.fill();
      } else if (e.kind === 'volcano') {
        const r = Math.min(6, 1 + e.t * 0.05) * SCALE;
        ctx.fillStyle = 'rgba(255,90,0,0.5)'; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,40,0.8)'; ctx.beginPath(); ctx.arc(px, py, r * 0.45, 0, 7); ctx.fill();
      }
    }
  }

  function draw() {
    if (terrainDirty) { buildTerrain(); buildDetail(); terrainDirty = false; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a1019';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(zoom, 0, 0, zoom, panX, panY);

    ctx.drawImage(terrain, 0, 0, W, H);
    // (sin "aura" de territorio: las ciudades cambian de color al ser conquistadas)
    ctx.drawImage(detail, 0, 0);
    ctx.drawImage(muni, 0, 0);

    const detailed = zoom >= 1.1;
    drawFree(detailed);
    drawUnits(detailed);
    drawAnimals(detailed);
    drawLeaders();
    drawCities();
    drawEffects();
  }

  function markTerrainDirty() { terrainDirty = true; }

  return { draw, markTerrainDirty, screenToTile, zoomAtClient, zoomByCenter, panByClient, fit, getZoom, SCALE };
}
