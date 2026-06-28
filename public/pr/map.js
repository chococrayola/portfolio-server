/* map.js — the Puerto Rico world.
 *
 * The island's shape and its 78 municipality regions come from real boundary
 * data, rasterized into public/pr/municipios.js (see scratchpad rasterize.mjs).
 * Here we turn that mask into a playable tile world: ocean vs. land, then a
 * layer of terrain (the Cordillera Central spine, the El Yunque rainforest, the
 * San Juan metro, and coastal beaches) painted on top of the real coastline.
 */

import { MCOLS, MROWS, OCEAN_ID, MGRID, NAMES, ABBR, CENTROIDS } from './municipios.js?v=30';

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

// --- Terrain gameplay modifiers ------------------------------------------
export const MOVE_COST = {
  [TILE.OCEAN]: 2.6, // navegable (en bote) — lento pero cruzable
  [TILE.BEACH]: 1.0,
  [TILE.GRASS]: 1.0,
  [TILE.HILL]: 1.6,
  [TILE.MOUNTAIN]: 2.6,
  [TILE.FOREST]: 1.8,
  [TILE.URBAN]: 0.9,
};

export const GROWTH_MOD = {
  [TILE.OCEAN]: 0,
  [TILE.BEACH]: 1.0,
  [TILE.GRASS]: 1.2,
  [TILE.HILL]: 0.8,
  [TILE.MOUNTAIN]: 0.4,
  [TILE.FOREST]: 0.7,
  [TILE.URBAN]: 1.5,
};

export const DEFENSE_MOD = {
  [TILE.OCEAN]: 1,
  [TILE.BEACH]: 0.9,
  [TILE.GRASS]: 1.0,
  [TILE.HILL]: 1.3,
  [TILE.MOUNTAIN]: 1.8,
  [TILE.FOREST]: 1.5,
  [TILE.URBAN]: 1.2,
};

export const idx = (x, y) => y * COLS + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
export const isOcean = (t) => t === TILE.OCEAN;
export const isLand = (t) => t !== TILE.OCEAN;
export const isBuildable = (t) =>
  t === TILE.GRASS || t === TILE.BEACH || t === TILE.HILL || t === TILE.URBAN;
export const isRough = (t) => t === TILE.MOUNTAIN || t === TILE.FOREST;

// Deterministic value-noise so a given seed yields the same terrain.
function makeNoise(seed) {
  return (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.137) * 43758.5453;
    return n - Math.floor(n);
  };
}
function fbm(noise, x, y) {
  let v = 0, a = 0.5, f = 0.09;
  for (let i = 0; i < 4; i++) { v += a * noise(x * f, y * f); a *= 0.5; f *= 2.0; }
  return v;
}

/**
 * Build the world from the real municipality mask.
 * @returns {{tiles, municipioId, muniNames, muniAbbr, muniCentroids, regions, starts}}
 */
export function generateMap(seed = 7) {
  const noise = makeNoise(seed);
  const tiles = new Uint8Array(COLS * ROWS).fill(TILE.OCEAN);

  // Land = any cell that belongs to a municipality.
  for (let i = 0; i < MGRID.length; i++) {
    if (MGRID[i] !== OCEAN_ID) tiles[i] = TILE.GRASS;
  }

  // San Juan metro (real centroid) anchors the north-coast urban + the NE.
  const sjIdx = NAMES.indexOf('San Juan');
  const sj = sjIdx >= 0 ? CENTROIDS[sjIdx] : [Math.round(COLS * 0.6), Math.round(ROWS * 0.2)];

  // Elevation pass: a central E–W ridge (Cordillera Central), biased slightly
  // south, becomes mountains; the flanks become hills.
  const ridgeRow = ROWS * 0.55;
  const spread = ROWS * 0.17;
  for (let y = 0; y < ROWS; y++) {
    const ridge = Math.exp(-Math.pow((y - ridgeRow) / spread, 2));
    for (let x = 0; x < COLS; x++) {
      if (tiles[idx(x, y)] === TILE.OCEAN) continue;
      // keep the small eastern islands (Vieques/Culebra) low and flat
      const elev = ridge * 0.82 + fbm(noise, x + 99, y + 51) * 0.5;
      if (elev > 0.9) tiles[idx(x, y)] = TILE.MOUNTAIN;
      else if (elev > 0.66) tiles[idx(x, y)] = TILE.HILL;
    }
  }

  // El Yunque rainforest — northeast of San Juan, inland.
  const eyx = sj[0] + COLS * 0.09;
  const eyy = sj[1] + ROWS * 0.16;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (tiles[idx(x, y)] === TILE.OCEAN) continue;
      const d = Math.hypot((x - eyx) / (COLS * 0.07), (y - eyy) / (ROWS * 0.16));
      if (d < 1 && fbm(noise, x + 7, y + 200) > 0.4) tiles[idx(x, y)] = TILE.FOREST;
    }
  }

  // Beaches: land tiles touching the ocean.
  const snapshot = tiles.slice();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tt = snapshot[idx(x, y)];
      if (tt !== TILE.GRASS && tt !== TILE.HILL) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny) || snapshot[idx(nx, ny)] === TILE.OCEAN) {
          tiles[idx(x, y)] = TILE.BEACH;
          break;
        }
      }
    }
  }

  // San Juan urban block on the real San Juan centroid.
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = sj[0] + dx, y = sj[1] + dy;
      if (inBounds(x, y) && tiles[idx(x, y)] !== TILE.OCEAN) tiles[idx(x, y)] = TILE.URBAN;
    }
  }

  const regions = {
    sanJuan: { x: sj[0], y: sj[1] },
    elYunque: { x: Math.round(eyx), y: Math.round(eyy) },
  };

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

// Look up which municipio a tile belongs to (255 = ocean).
export function municipioAt(x, y) {
  if (!inBounds(x, y)) return OCEAN_ID;
  return MGRID[idx(x, y)];
}
export { NAMES as MUNI_NAMES, ABBR as MUNI_ABBR, CENTROIDS as MUNI_CENTROIDS, OCEAN_ID };
