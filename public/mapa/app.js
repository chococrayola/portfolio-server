// Interactive Puerto Rico nature & photography map.
// Built on Leaflet (loaded globally as `L` from the CDN in mapa.html) +
// free OpenStreetMap tiles. No API key required.

import { CATEGORIES, getCategory } from './categories.js';
import { PLACES } from './places.js';

// --- Map setup -------------------------------------------------------------

// Center on Puerto Rico. maxBounds keeps the user roughly over the island
// (with padding for Culebra/Vieques to the east).
const PR_CENTER = [18.22, -66.4];
const map = L.map('map', {
  center: PR_CENTER,
  zoom: 9,
  minZoom: 8,
  maxZoom: 18,
  maxBounds: [
    [17.7, -67.6], // southwest
    [18.7, -65.0], // northeast
  ],
  maxBoundsViscosity: 0.7,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// --- "Visited" state -------------------------------------------------------
// Which places you've already been to. Stored on your device (localStorage)
// so it survives reloads. Seeded once from any place with `visited: true` in
// places.js, then fully controlled by the "Marcar como visitado" button.

const STORE_KEY = 'mapa-visitados';
const INIT_KEY = 'mapa-visitados-init';

function loadVisited() {
  try {
    if (localStorage.getItem(INIT_KEY) !== '1') {
      const seed = PLACES.filter((p) => p.visited).map((p) => p.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(seed));
      localStorage.setItem(INIT_KEY, '1');
      return new Set(seed);
    }
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'));
  } catch (e) {
    // localStorage blocked (e.g. private mode) — fall back to the data flags.
    return new Set(PLACES.filter((p) => p.visited).map((p) => p.id));
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
  marker.bindPopup(() => popupHtml(place), { maxWidth: 300 });
  marker.addTo(layer);
  markersById[place.id] = { marker, place, category: cat };
  placed++;
}

// --- Visited toggle wiring -------------------------------------------------

// When a popup opens, wire its "Marcar como visitado" button. The popup DOM
// is rebuilt on each open, so attaching here (and letting it die with the
// popup on close) avoids leaks.
map.on('popupopen', (e) => {
  const root = e.popup.getElement();
  if (!root) return;
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
    <div class="legend-head">Categorías</div>
    ${rows}
    <div class="legend-note"><b>✓</b> = ya visitado</div>`;

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
