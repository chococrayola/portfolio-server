/* map.js — the Puerto Rico world.
 *
 * Generates a stylized but recognizable silhouette of Puerto Rico on a pixel
 * grid, complete with the Cordillera Central mountain spine, the El Yunque
 * rainforest in the northeast, the San Juan metro on the north coast, and the
 * offshore islands of Vieques and Culebra (plus a speck of Mona to the west).
 *
 * Everything downstream (sim, render, powers) treats the world as a flat
 * Uint8Array of tile types plus a handful of terrain modifier lookups.
 */

export const COLS = 168;
export const ROWS = 60;

export const TILE = {
  OCEAN: 0,
  BEACH: 1,
  GRASS: 2,
  HILL: 3,
  MOUNTAIN: 4,
  FOREST: 5,
  URBAN: 6,
};

// Base colors for each terrain (rendered as flat pixels).
export const TILE_COLOR = {
  [TILE.OCEAN]: '#1c5e8c',
  [TILE.BEACH]: '#e6d59a',
  [TILE.GRASS]: '#6aa84f',
  [TILE.HILL]: '#4e7d3a',
  [TILE.MOUNTAIN]: '#7a6a55',
  [TILE.FOREST]: '#2f6b32',
  [TILE.URBAN]: '#9aa0a6',
};

// --- Terrain gameplay modifiers ------------------------------------------
// Movement points needed to enter a tile (higher = slower).
export const MOVE_COST = {
  [TILE.OCEAN]: Infinity,
  [TILE.BEACH]: 1.0,
  [TILE.GRASS]: 1.0,
  [TILE.HILL]: 1.6,
  [TILE.MOUNTAIN]: 2.6,
  [TILE.FOREST]: 1.8,
  [TILE.URBAN]: 0.9,
};

// How fast cities/population grow on this tile.
export const GROWTH_MOD = {
  [TILE.OCEAN]: 0,
  [TILE.BEACH]: 1.0,
  [TILE.GRASS]: 1.2,
  [TILE.HILL]: 0.8,
  [TILE.MOUNTAIN]: 0.4,
  [TILE.FOREST]: 0.7,
  [TILE.URBAN]: 1.5,
};

// Defensive multiplier for a unit standing on this tile.
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
// Tiles a city can be founded on (no mountains/forest/ocean).
export const isBuildable = (t) =>
  t === TILE.GRASS || t === TILE.BEACH || t === TILE.HILL || t === TILE.URBAN;
// Terrain that gives the Independentistas their guerrilla edge.
export const isRough = (t) => t === TILE.MOUNTAIN || t === TILE.FOREST;

// Deterministic value-noise so the same seed yields the same island.
function makeNoise(seed) {
  return (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.137) * 43758.5453;
    return n - Math.floor(n); // 0..1
  };
}
function fbm(noise, x, y) {
  let v = 0;
  let a = 0.5;
  let f = 0.09;
  for (let i = 0; i < 4; i++) {
    v += a * noise(x * f, y * f);
    a *= 0.5;
    f *= 2.0;
  }
  return v; // ~0..0.93
}

/**
 * Build the world.
 * @param {number} seed
 * @returns {{tiles: Uint8Array, regions: object, starts: Array}}
 */
export function generateMap(seed = 7) {
  const noise = makeNoise(seed);
  const tiles = new Uint8Array(COLS * ROWS).fill(TILE.OCEAN);

  // Main island geometry: an elongated rounded rectangle (~3:1), shifted left
  // to leave sea room for Vieques/Culebra on the east.
  const cx = COLS * 0.455;
  const cy = ROWS * 0.52;
  const hw = COLS * 0.435;
  const hh = ROWS * 0.33;

  const inMain = (x, y) => {
    const nx = (x - cx) / hw;
    const ny = (y - cy) / hh;
    const wob = (fbm(noise, x + 11, y + 7) - 0.5) * 0.32;
    return Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 2.3) + wob < 1.0;
  };

  // Small offshore island helper (filled ellipse).
  const stampIsland = (ecx, ecy, rx, ry) => {
    for (let y = Math.floor(ecy - ry); y <= ecy + ry; y++) {
      for (let x = Math.floor(ecx - rx); x <= ecx + rx; x++) {
        if (!inBounds(x, y)) continue;
        const dx = (x - ecx) / rx;
        const dy = (y - ecy) / ry;
        if (dx * dx + dy * dy <= 1) tiles[idx(x, y)] = TILE.GRASS;
      }
    }
  };

  // Lay down the main island as grass first.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (inMain(x, y)) tiles[idx(x, y)] = TILE.GRASS;
    }
  }

  // Offshore islands (east) + a speck of Mona (far west).
  const culebra = { x: cx + hw * 1.0, y: cy - hh * 0.62 };
  const vieques = { x: cx + hw * 1.03, y: cy + hh * 0.18 };
  stampIsland(culebra.x, culebra.y, 2.4, 1.8);
  stampIsland(vieques.x, vieques.y, 4.2, 1.7);
  stampIsland(cx - hw * 1.12, cy + hh * 0.05, 1.6, 1.4); // Mona

  // Elevation pass: ridge band (slightly south of center) becomes mountains.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (tiles[idx(x, y)] === TILE.OCEAN) continue;
      const ny = (y - cy) / hh;
      const ridge = Math.exp(-Math.pow((ny + 0.12) / 0.34, 2));
      const elev = ridge * 0.8 + fbm(noise, x + 99, y + 51) * 0.55;
      if (elev > 0.86) tiles[idx(x, y)] = TILE.MOUNTAIN;
      else if (elev > 0.62) tiles[idx(x, y)] = TILE.HILL;
    }
  }

  // El Yunque rainforest — northeast quadrant cluster.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (tiles[idx(x, y)] === TILE.OCEAN) continue;
      const nx = (x - cx) / hw;
      const ny = (y - cy) / hh;
      if (nx > 0.42 && nx < 0.82 && ny > -0.85 && ny < -0.1) {
        if (fbm(noise, x + 7, y + 200) > 0.42) tiles[idx(x, y)] = TILE.FOREST;
      }
    }
  }

  // Beaches: land tiles touching the ocean (don't carve up the highlands).
  const snapshot = tiles.slice();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = snapshot[idx(x, y)];
      if (t !== TILE.GRASS && t !== TILE.HILL) continue;
      let coast = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nxp = x + dx;
        const nyp = y + dy;
        if (!inBounds(nxp, nyp) || snapshot[idx(nxp, nyp)] === TILE.OCEAN) {
          coast = true;
          break;
        }
      }
      if (coast) tiles[idx(x, y)] = TILE.BEACH;
    }
  }

  // San Juan metro: a small urban block on the north-central coast.
  const sjX = Math.round(cx);
  let sjY = 0;
  for (let y = 0; y < ROWS; y++) {
    if (tiles[idx(sjX, y)] !== TILE.OCEAN) { sjY = y; break; }
  }
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = sjX + dx;
      const y = sjY + dy;
      if (inBounds(x, y) && tiles[idx(x, y)] !== TILE.OCEAN) {
        tiles[idx(x, y)] = TILE.URBAN;
      }
    }
  }

  const regions = {
    sanJuan: { x: sjX, y: sjY + 1 },
    elYunque: { x: Math.round(cx + hw * 0.6), y: Math.round(cy - hh * 0.4) },
    culebra,
    vieques,
    cordillera: { x: Math.round(cx), y: Math.round(cy + hh * 0.15) },
  };

  // Balanced starting anchors in three separate regions (west / east / south).
  const starts = [
    { x: Math.round(cx - hw * 0.62), y: Math.round(cy + hh * 0.05) }, // west
    { x: Math.round(cx + hw * 0.6), y: Math.round(cy - hh * 0.15) }, // east
    { x: Math.round(cx - hw * 0.02), y: Math.round(cy + hh * 0.5) }, // south
  ].map((p) => nearestLand(tiles, p.x, p.y));

  return { tiles, regions, starts };
}

// Spiral out from (x,y) to the closest buildable land tile.
export function nearestLand(tiles, x, y) {
  if (inBounds(x, y) && isBuildable(tiles[idx(x, y)])) return { x, y };
  for (let r = 1; r < Math.max(COLS, ROWS); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(nx, ny) && isBuildable(tiles[idx(nx, ny)])) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return { x, y };
}
