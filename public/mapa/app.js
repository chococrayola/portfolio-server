// Interactive Puerto Rico nature & photography map.
// Built on Leaflet (loaded globally as `L` from the CDN in mapa.html) +
// free OpenStreetMap tiles. No API key required.

// Keep the ?v= in sync with mapa.html (bump on every change to these files).
import { CATEGORIES, getCategory } from './categories.js?v=4';
import { PLACES } from './places.js?v=4';

// --- Map setup -------------------------------------------------------------

// Center on Puerto Rico. maxBounds keeps the user roughly over the island
// (with padding for Culebra/Vieques to the east).
const PR_CENTER = [18.22, -66.4];
const map = L.map('map', {
  center: PR_CENTER,
  zoom: 9,
  zoomSnap: 0.5, // lets fitBounds pick a fractional zoom that fits narrow screens
  minZoom: 8,
  maxZoom: 18,
  // Just a loose leash. A tall phone at minimum zoom shows ~4° of latitude, so
  // bounds tighter than the screen stop Leaflet from panning at all (popups
  // near the top then open half off-screen). minZoom keeps the island framed.
  maxBounds: [
    [15.5, -70.5], // southwest
    [21.0, -62.0], // northeast
  ],
  maxBoundsViscosity: 0.7,
});

// Start with the whole island in view (zoom 9 was wider than a phone screen).
map.fitBounds([[17.85, -67.3], [18.55, -65.2]], { padding: [8, 8] });

// One host (no a/b/c subdomains): OSM serves HTTP/2, so a single connection is
// faster than opening three separate TLS connections.
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
  keepBuffer: 1,
  updateWhenIdle: true,
}).addTo(map);

// --- Loading / slow-connection feedback ------------------------------------

const loadingEl = document.getElementById('map-loading');
const warnEl = document.getElementById('tile-warning');
let tileErrors = 0;
let tilesLoaded = 0;
function mapIsReady() {
  window.__mapReady = true;
  if (loadingEl) loadingEl.hidden = true;
}
// Pins/legend work without the base map, so hide the spinner on the first
// tile OR once the app has drawn (whichever comes first).
tiles.on('tileload', () => {
  tilesLoaded++;
  tileErrors = 0;
  if (warnEl) warnEl.hidden = true;
  mapIsReady();
});
tiles.on('tileerror', () => {
  tileErrors++;
  if (tileErrors >= 3 && tilesLoaded === 0 && warnEl) warnEl.hidden = false;
});
const retryBtn = document.getElementById('tile-retry');
if (retryBtn) {
  retryBtn.addEventListener('click', () => {
    tileErrors = 0;
    if (warnEl) warnEl.hidden = true;
    tiles.redraw();
  });
}

// --- "Visited" state -------------------------------------------------------
// Which places you've already been to. Stored on your device (localStorage)
// so it survives reloads. Places flagged `visited: true` in places.js are
// applied as one-time "seeds": each seed id is added the first time this
// device sees it (so newly flagged places show up even on devices that
// already loaded the map), then the set is fully controlled by the
// "Marcar como visitado" button — un-marking a seeded place sticks.

const STORE_KEY = 'mapa-visitados';
const SEEDED_KEY = 'mapa-visitados-seeded'; // seed ids already applied here
const LEGACY_INIT_KEY = 'mapa-visitados-init';

function loadVisited() {
  const seedIds = PLACES.filter((p) => p.visited).map((p) => p.id);
  try {
    const set = new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'));
    let applied = new Set(JSON.parse(localStorage.getItem(SEEDED_KEY) || '[]'));
    // Migrate from the old boolean init flag. The legacy scheme only ever
    // shipped with these two seeds, so exactly those count as applied —
    // any seed added later must still go through the loop below.
    if (localStorage.getItem(LEGACY_INIT_KEY) === '1') {
      applied = new Set([...applied, 'cueva-indio', 'jardin-botanico-sj']);
      localStorage.removeItem(LEGACY_INIT_KEY);
    }
    let changed = false;
    for (const id of seedIds) {
      if (!applied.has(id)) {
        set.add(id);
        applied.add(id);
        changed = true;
      }
    }
    localStorage.setItem(SEEDED_KEY, JSON.stringify([...applied]));
    if (changed) localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
    return set;
  } catch (e) {
    // localStorage blocked (e.g. private mode) — fall back to the data flags.
    return new Set(seedIds);
  }
}

function saveVisited() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...visited]));
  } catch (e) {
    /* ignore write failures */
  }
}

const visited = loadVisited();
const isVisited = (id) => visited.has(id);

// --- Helpers ---------------------------------------------------------------

// A teardrop pin built from HTML, showing the category emoji on a colored
// circle. Returned as a Leaflet divIcon so we don't need image files.
// Visited places get a green ✓ badge and a subtly muted look.
function makeIcon(category, vis) {
  const { emoji, color } = category;
  const check = vis ? '<div class="pin-check">✓</div>' : '';
  const html = `
    <div class="pin${vis ? ' visited' : ''}" style="--pin-color:${color}">
      <div class="pin-bubble"><span class="pin-emoji">${emoji}</span></div>
      ${check}
      <div class="pin-tip"></div>
    </div>`;
  return L.divIcon({
    className: 'pin-wrap',
    html,
    iconSize: [34, 44],
    iconAnchor: [17, 42],      // bottom tip points at the coordinate
    popupAnchor: [0, -40],
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Builds the popup HTML for a place, including Google Maps links and the
// "visited" badge + toggle button.
function popupHtml(place) {
  const cat = getCategory(place.category);
  const { lat, lng } = place;
  const vis = isVisited(place.id);
  // Directions use exact coordinates (precise even for remote spots with no
  // Google listing). "Ver en el mapa" searches by name so Google shows the
  // place card when it knows the spot.
  const nameQuery = encodeURIComponent(
    [place.name, place.municipio, 'Puerto Rico'].filter(Boolean).join(', ')
  );
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const view = `https://www.google.com/maps/search/?api=1&query=${nameQuery}`;

  const rows = [];
  if (place.municipio) {
    rows.push(`<div class="popup-meta">📍 ${escapeHtml(place.municipio)}</div>`);
  }
  if (place.description) {
    rows.push(`<p class="popup-desc">${escapeHtml(place.description)}</p>`);
  }
  if (place.photoTips) {
    rows.push(`<p class="popup-tip"><strong>📷 Foto:</strong> ${escapeHtml(place.photoTips)}</p>`);
  }
  if (place.access) {
    rows.push(`<p class="popup-access"><strong>🚶 Acceso:</strong> ${escapeHtml(place.access)}</p>`);
  }

  const visitedBadge = vis ? '<div class="popup-visited">✅ Ya fuiste aquí</div>' : '';

  return `
    <div class="popup${vis ? ' is-visited' : ''}">
      <div class="popup-badge" style="--badge-color:${cat.color}">
        <span>${cat.emoji}</span> ${escapeHtml(cat.label)}
      </div>
      <h3 class="popup-title">${escapeHtml(place.name)}</h3>
      ${visitedBadge}
      ${rows.join('')}
      <div class="popup-actions">
        <a class="btn-directions" href="${directions}" target="_blank" rel="noopener">
          🧭 Cómo llegar (Google Maps)
        </a>
        <a class="btn-view" href="${view}" target="_blank" rel="noopener">
          Ver en el mapa
        </a>
        <button type="button" class="btn-visited" data-id="${escapeHtml(place.id)}">
          ${vis ? '↩︎ Quitar de visitados' : '✓ Marcar como visitado'}
        </button>
      </div>
    </div>`;
}

// --- Build per-category layers and markers ---------------------------------

// One layer group per category so the legend can toggle each independently.
const layers = {};
for (const key of Object.keys(CATEGORIES)) {
  layers[key] = L.layerGroup().addTo(map);
}

// Keep a handle on every marker so the visited toggle can refresh its icon.
const markersById = {};

let placed = 0;
for (const place of PLACES) {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue;
  const cat = getCategory(place.category);
  const layer = layers[place.category] || layers[Object.keys(layers)[0]];
  const marker = L.marker([place.lat, place.lng], {
    icon: makeIcon(cat, isVisited(place.id)),
    title: place.name,
  });
  // Bind as a function so every re-open reflects the current visited state.
  marker.bindPopup(() => popupHtml(place), {
    maxWidth: 300,
    autoPanPaddingTopLeft: [16, 16],
    autoPanPaddingBottomRight: [16, 16],
  });
  marker.addTo(layer);
  markersById[place.id] = { marker, place, category: cat };
  placed++;
}

// --- Pin size by zoom ------------------------------------------------------
// With 100+ places, full-size pins pile on top of each other when the whole
// island is in view (especially on phones). Shrink them when zoomed out.
function updatePinScale() {
  const z = map.getZoom();
  const el = map.getContainer();
  el.classList.toggle('pins-xs', z < 9);
  el.classList.toggle('pins-sm', z >= 9 && z < 10.5);
}
map.on('zoomend', updatePinScale);
updatePinScale();

// --- Visited toggle wiring -------------------------------------------------

// When a popup opens, wire its "Marcar como visitado" button. Leaflet
// creates each popup's DOM container once and REUSES it on every reopen
// (DivOverlay.onAdd: `this._container || this._initLayout()`), so guard
// with a dataset flag — otherwise each reopen stacks another listener and
// one tap would toggle multiple times.
map.on('popupopen', (e) => {
  const root = e.popup.getElement();
  if (!root || root.dataset.visitedWired) return;
  root.dataset.visitedWired = '1';
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.btn-visited');
    if (!btn) return;
    ev.stopPropagation();
    const id = btn.getAttribute('data-id');
    const entry = markersById[id];
    if (!entry) return;
    const nowVisited = !visited.has(id);
    if (nowVisited) visited.add(id);
    else visited.delete(id);
    saveVisited();
    // Update the marker's ✓ badge and the header count.
    entry.marker.setIcon(makeIcon(entry.category, nowVisited));
    updateCounter();
    // Update the OPEN popup in place (replacing content would close it).
    // Re-opening later regenerates fresh content via the bound function.
    const popupEl = root.querySelector('.popup');
    if (!popupEl) return;
    popupEl.classList.toggle('is-visited', nowVisited);
    btn.textContent = nowVisited ? '↩︎ Quitar de visitados' : '✓ Marcar como visitado';
    let badge = popupEl.querySelector('.popup-visited');
    if (nowVisited && !badge) {
      badge = document.createElement('div');
      badge.className = 'popup-visited';
      badge.textContent = '✅ Ya fuiste aquí';
      popupEl.querySelector('.popup-title').after(badge);
    } else if (!nowVisited && badge) {
      badge.remove();
    }
  });
});

// --- Legend (doubles as layer toggles) -------------------------------------

const LEGEND_KEY = 'mapa-leyenda-colapsada';
const legend = L.control({ position: 'topright' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  // Stop map drag/zoom when interacting with the legend.
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  let rows = '';
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    rows += `
      <label class="legend-row">
        <input type="checkbox" data-cat="${key}" checked />
        <span class="legend-dot" style="background:${cat.color}">${cat.emoji}</span>
        <span class="legend-label">${cat.label}</span>
      </label>`;
  }

  div.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="true">
      <span class="legend-head">🗂️ Categorías</span>
      <span class="legend-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="legend-body">
      ${rows}
      <div class="legend-note"><b>✓</b> = ya visitado</div>
    </div>`;

  // Collapsible: starts collapsed on phones (the open legend covered most of
  // the map), open on larger screens. The user's last choice is remembered.
  const toggle = div.querySelector('.legend-toggle');
  const setCollapsed = (collapsed, save) => {
    div.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    if (save) {
      try { localStorage.setItem(LEGEND_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    }
  };
  let stored = null;
  try { stored = localStorage.getItem(LEGEND_KEY); } catch (e) { /* ignore */ }
  setCollapsed(stored !== null ? stored === '1' : window.matchMedia('(max-width: 640px)').matches, false);
  toggle.addEventListener('click', () => setCollapsed(!div.classList.contains('collapsed'), true));

  // Wire each checkbox to add/remove its layer.
  div.querySelectorAll('input[data-cat]').forEach((box) => {
    box.addEventListener('change', () => {
      const key = box.getAttribute('data-cat');
      const layer = layers[key];
      if (!layer) return;
      if (box.checked) {
        map.addLayer(layer);
      } else {
        map.removeLayer(layer);
      }
    });
  });

  return div;
};
legend.addTo(map);

// --- Header counters -------------------------------------------------------

const placeCounter = document.getElementById('place-count');
if (placeCounter) placeCounter.textContent = String(placed);

// Update the "N visitados" figure in the header.
function updateCounter() {
  const el = document.getElementById('visited-count');
  if (el) el.textContent = String(visited.size);
}
updateCounter();

// App is drawn: pins, legend and counters exist. Hide the spinner now; the base
// map tiles keep streaming in underneath.
mapIsReady();
