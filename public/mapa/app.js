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

// --- Helpers ---------------------------------------------------------------

// A teardrop pin built from HTML, showing the category emoji on a colored
// circle. Returned as a Leaflet divIcon so we don't need image files.
function makeIcon(category) {
  const { emoji, color } = category;
  const html = `
    <div class="pin" style="--pin-color:${color}">
      <div class="pin-bubble"><span class="pin-emoji">${emoji}</span></div>
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

// Builds the popup HTML for a place, including Google Maps links.
function popupHtml(place) {
  const cat = getCategory(place.category);
  const { lat, lng } = place;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const view = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

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

  return `
    <div class="popup">
      <div class="popup-badge" style="--badge-color:${cat.color}">
        <span>${cat.emoji}</span> ${escapeHtml(cat.label)}
      </div>
      <h3 class="popup-title">${escapeHtml(place.name)}</h3>
      ${rows.join('')}
      <div class="popup-actions">
        <a class="btn-directions" href="${directions}" target="_blank" rel="noopener">
          🧭 Cómo llegar (Google Maps)
        </a>
        <a class="btn-view" href="${view}" target="_blank" rel="noopener">
          Ver en el mapa
        </a>
      </div>
    </div>`;
}

// --- Build per-category layers and markers ---------------------------------

// One layer group per category so the legend can toggle each independently.
const layers = {};
for (const key of Object.keys(CATEGORIES)) {
  layers[key] = L.layerGroup().addTo(map);
}

let placed = 0;
for (const place of PLACES) {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue;
  const cat = getCategory(place.category);
  const layer = layers[place.category] || layers[Object.keys(layers)[0]];
  const marker = L.marker([place.lat, place.lng], {
    icon: makeIcon(cat),
    title: place.name,
  });
  marker.bindPopup(popupHtml(place), { maxWidth: 300 });
  marker.addTo(layer);
  placed++;
}

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
    ${rows}`;

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

// Show how many spots are loaded in the header counter, if present.
const counter = document.getElementById('place-count');
if (counter) counter.textContent = String(placed);
