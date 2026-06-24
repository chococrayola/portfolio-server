/* render.js — draws the world to a canvas with crisp pixel scaling.
 *
 * Layers, bottom to top:
 *   terrain (cached 1px/tile, rebuilt only on terraform)
 *   civ-territory fill (cached 1px/tile, rebuilt each frame)
 *   municipio overlay (real municipality borders + abbreviated names, built ONCE)
 *   units, then city markers.
 */

import { COLS, ROWS, TILE_COLOR, idx, isOcean, MUNI_ABBR, MUNI_CENTROIDS } from './map.js';
import { MGRID, OCEAN_ID } from './municipios.js';

const SCALE = 6; // device pixels per tile

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createRenderer(canvas, world) {
  canvas.width = COLS * SCALE;
  canvas.height = ROWS * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Offscreen 1px/tile layers.
  const terrain = document.createElement('canvas');
  terrain.width = COLS; terrain.height = ROWS;
  const tctx = terrain.getContext('2d');
  const terrainImg = tctx.createImageData(COLS, ROWS);

  const terr = document.createElement('canvas');
  terr.width = COLS; terr.height = ROWS;
  const terrCtx = terr.getContext('2d');
  const terrImg = terrCtx.createImageData(COLS, ROWS);

  const civRgb = world.civs.map((c) => hexToRgb(c.color));
  const tileRgb = {};
  for (const k of Object.keys(TILE_COLOR)) tileRgb[k] = hexToRgb(TILE_COLOR[k]);

  let terrainDirty = true;

  // ---- Static municipio overlay (borders + abbreviated labels) ----------
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width; overlay.height = canvas.height;
  (function buildOverlay() {
    const o = overlay.getContext('2d');
    // Internal municipal borders: an edge between two different land municipios.
    o.strokeStyle = 'rgba(15,23,32,0.45)';
    o.lineWidth = 1;
    o.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const a = MGRID[idx(x, y)];
        if (a === OCEAN_ID) continue;
        if (x + 1 < COLS) {
          const b = MGRID[idx(x + 1, y)];
          if (b !== OCEAN_ID && b !== a) {
            o.moveTo((x + 1) * SCALE + 0.5, y * SCALE);
            o.lineTo((x + 1) * SCALE + 0.5, (y + 1) * SCALE);
          }
        }
        if (y + 1 < ROWS) {
          const b = MGRID[idx(x, y + 1)];
          if (b !== OCEAN_ID && b !== a) {
            o.moveTo(x * SCALE, (y + 1) * SCALE + 0.5);
            o.lineTo((x + 1) * SCALE, (y + 1) * SCALE + 0.5);
          }
        }
      }
    }
    o.stroke();
    // Abbreviated municipality names at each centroid.
    o.font = `bold ${Math.round(SCALE * 1.5)}px system-ui, sans-serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.lineWidth = 2.5;
    o.strokeStyle = 'rgba(10,16,24,0.85)';
    o.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < MUNI_ABBR.length; i++) {
      const c = MUNI_CENTROIDS[i];
      const px = c[0] * SCALE + SCALE / 2;
      const py = c[1] * SCALE + SCALE / 2;
      o.strokeText(MUNI_ABBR[i], px, py);
      o.fillText(MUNI_ABBR[i], px, py);
    }
  })();

  function buildTerrain() {
    const d = terrainImg.data;
    for (let i = 0; i < world.tiles.length; i++) {
      const [r, g, b] = tileRgb[world.tiles[i]];
      const p = i * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    tctx.putImageData(terrainImg, 0, 0);
    terrainDirty = false;
  }

  function buildTerritory() {
    const d = terrImg.data;
    const owner = world.owner;
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i];
      const p = i * 4;
      if (o < 0 || isOcean(world.tiles[i])) {
        d[p + 3] = 0;
      } else {
        const [r, g, b] = civRgb[o];
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 120;
      }
    }
    terrCtx.putImageData(terrImg, 0, 0);
  }

  function draw() {
    if (terrainDirty) buildTerrain();
    buildTerritory();

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(terrain, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(terr, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(overlay, 0, 0);

    // Units.
    for (const u of world.units) {
      ctx.fillStyle = world.civs[u.civ].color;
      ctx.fillRect(u.x * SCALE, u.y * SCALE, SCALE, SCALE);
    }

    // Cities — bigger markers sized by population.
    for (const c of world.cities) {
      const civ = world.civs[c.civ];
      const s = SCALE + Math.min(10, c.pop * 0.3);
      const cx = c.x * SCALE + SCALE / 2;
      const cy = c.y * SCALE + SCALE / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2);
      ctx.fillStyle = civ.colorDark;
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      if (c.hp < c.maxHp) {
        const w = s;
        ctx.fillStyle = '#000';
        ctx.fillRect(cx - w / 2, cy - s / 2 - 4, w, 2);
        ctx.fillStyle = '#3fd96b';
        ctx.fillRect(cx - w / 2, cy - s / 2 - 4, w * (c.hp / c.maxHp), 2);
      }
    }
  }

  function markTerrainDirty() { terrainDirty = true; }

  function screenToTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * COLS);
    const y = Math.floor(((clientY - rect.top) / rect.height) * ROWS);
    return { x, y };
  }

  return { draw, markTerrainDirty, screenToTile, SCALE };
}
