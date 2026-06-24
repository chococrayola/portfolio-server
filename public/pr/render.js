/* render.js — draws the world to a canvas with crisp pixel scaling.
 *
 * Terrain is cached on a 1px-per-tile offscreen canvas and only rebuilt when
 * the land is terraformed. Territory, cities and units are drawn fresh each
 * frame on top.
 */

import { COLS, ROWS, TILE_COLOR, idx, isOcean } from './map.js';

const SCALE = 7; // device pixels per tile

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
  terrain.width = COLS;
  terrain.height = ROWS;
  const tctx = terrain.getContext('2d');
  const terrainImg = tctx.createImageData(COLS, ROWS);

  const terr = document.createElement('canvas');
  terr.width = COLS;
  terr.height = ROWS;
  const terrCtx = terr.getContext('2d');
  const terrImg = terrCtx.createImageData(COLS, ROWS);

  const civRgb = world.civs.map((c) => hexToRgb(c.color));
  const tileRgb = {};
  for (const k of Object.keys(TILE_COLOR)) tileRgb[k] = hexToRgb(TILE_COLOR[k]);

  let terrainDirty = true;

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
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 110;
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
      // health bar if damaged
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
