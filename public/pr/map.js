/* map.js — the Puerto Rico world.
 *
 * The island's shape and its 78 municipality regions come from real boundary
 * data, rasterized into public/pr/municipios.js (see scratchpad rasterize.mjs).
 * Here we turn that mask into a playable tile world: a flat green island
 * (grass) ringed by sandy coasts (beach) — no mountains, hills, forest or
 * urban terrain, just the real coastline.
 */

import { MCOLS, MROWS, OCEAN_ID, MGRID, NAMES, ABBR, CENTROIDS } from './municipios.js?v=39';

export const COLS = MCOLS;
export const ROWS = MROWS;

export const TILE = {
  OCEAN: 0,
  BEACH: 1,
  GRASS: 2,
  HILL: 3,
  MOUNTAIN: 4,
  FOREST: 5,
  URBAN: 6,
};

// Warmer, higher-contrast WorldBox-ish biome palette.
export const TILE_COLOR = {
  [TILE.OCEAN]: '#2a82bd',
  [TILE.BEACH]: '#efdca0',
  [TILE.GRASS]: '#7cc24f',
  [TILE.HILL]: '#5b9a3d',
  [TILE.MOUNTAIN]: '#8a7a64',
  [TILE.FOREST]: '#2f7a3a',
  [TILE.URBAN]: '#b3b9bf',
};

export const idx = (x, y) => y * COLS + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
export const isOcean = (t) => t === TILE.OCEAN;
export const isLand = (t) => t !== TILE.OCEAN;
export const isBuildable = (t) =>
  t === TILE.GRASS || t === TILE.BEACH || t === TILE.HILL || t === TILE.URBAN;


/**
 * Build the world from the real municipality mask.
 * @returns {{tiles, municipioId, muniNames, muniAbbr, muniCentroids, regions, starts}}
 */
export function generateMap(seed = 7) {
  const tiles = new Uint8Array(COLS * ROWS).fill(TILE.OCEAN);

  // Land = any cell that belongs to a municipality. Terreno plano: sólo verde
  // (grass) tierra adentro y arena (beach) en la costa — sin montañas, colinas,
  // bosque ni zona urbana.
  for (let i = 0; i < MGRID.length; i++) {
    if (MGRID[i] !== OCEAN_ID) tiles[i] = TILE.GRASS;
  }

  // Beaches: land tiles touching the ocean (la costa).
  const snapshot = tiles.slice();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (snapshot[idx(x, y)] !== TILE.GRASS) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny) || snapshot[idx(nx, ny)] === TILE.OCEAN) {
          tiles[idx(x, y)] = TILE.BEACH;
          break;
        }
      }
    }
  }

  const regions = {};

  // Spread starting anchors across the main island (one per party).
  const starts = [
    { x: Math.round(COLS * 0.10), y: Math.round(ROWS * 0.55) }, // oeste (Mayagüez)
    { x: Math.round(COLS * 0.45), y: Math.round(ROWS * 0.30) }, // norte-centro (San Juan)
    { x: Math.round(COLS * 0.33), y: Math.round(ROWS * 0.66) }, // montañas centrales
    { x: Math.round(COLS * 0.68), y: Math.round(ROWS * 0.42) }, // este
    { x: Math.round(COLS * 0.56), y: Math.round(ROWS * 0.72) }, // sur
  ].map((p) => nearestLand(tiles, p.x, p.y));

  return {
    tiles,
    municipioId: MGRID,
    muniNames: NAMES,
    muniAbbr: ABBR,
    muniCentroids: CENTROIDS,
    regions,
    starts,
  };
}

// Spiral out to the closest buildable land tile.
export function nearestLand(tiles, x, y) {
  if (inBounds(x, y) && isBuildable(tiles[idx(x, y)])) return { x, y };
  for (let r = 1; r < Math.max(COLS, ROWS); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && isBuildable(tiles[idx(nx, ny)])) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
}

export { NAMES as MUNI_NAMES, ABBR as MUNI_ABBR, CENTROIDS as MUNI_CENTROIDS, OCEAN_ID };
