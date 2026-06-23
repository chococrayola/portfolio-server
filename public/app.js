/* Tinder Score — personal profile-rating game.
 * All state lives in localStorage; no backend involved. */

const STORAGE = {
  categories: 'ts.categories',
  threshold: 'ts.threshold',
  history: 'ts.history',
};

const DEFAULT_THRESHOLD = 50;

// Each category: { id, name, points }. Rendered into tappable score cards.
const DEFAULT_CATEGORIES = [
  // User's original list
  { id: 'face',      name: 'Only face photos',   points: 20 },
  { id: 'bikini',    name: 'Bikini photo',       points: 5 },
  { id: 'male',      name: 'Male',               points: -50 },
  { id: 'trans',     name: 'Transgender',        points: -10 },
  { id: 'beach',     name: 'Likes the beach',    points: 5 },
  { id: 'alcohol',   name: 'Photo with alcohol', points: 5 },
  { id: 'smoking',   name: 'Photo smoking',      points: 10 },
  { id: 'onephoto',  name: 'Only 1 photo',       points: 10 },
  { id: 'dogs',      name: 'Photo with dogs',    points: 5 },
  { id: 'travel',    name: 'Loves to travel',    points: 10 },
  // Profile quality (+)
  { id: 'verified',  name: 'Verified profile',   points: 15 },
  { id: 'bio',       name: 'Has a real bio',     points: 10 },
  { id: 'manyphoto', name: '3+ photos',          points: 10 },
  { id: 'smiling',   name: 'Smiling',            points: 5 },
  // Interests (+)
  { id: 'gym',       name: 'Gym / fitness',      points: 5 },
  { id: 'cooking',   name: 'Cooking / food',     points: 5 },
  { id: 'music',     name: 'Music you like',     points: 5 },
  { id: 'reading',   name: 'Reading / books',    points: 5 },
  { id: 'cat',       name: 'Has a cat',          points: 5 },
  // Red flags (-)
  { id: 'noface',    name: 'No face visible',    points: -20 },
  { id: 'filters',   name: 'Heavy filters',      points: -5 },
  { id: 'group',     name: 'Group-only photos',  points: -5 },
  { id: 'mlm',       name: 'MLM / crypto bio',   points: -15 },
  { id: 'drama',     name: 'Drama / ex mention', points: -10 },
];

// ---- State ----
let categories = loadCategories();
let threshold = loadThreshold();
let history = loadHistory();
let tally = {}; // categoryId -> count for the profile currently being rated

// ---- Persistence helpers ----
function loadCategories() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.categories));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (_) {}
  return structuredClone(DEFAULT_CATEGORIES);
}
function loadThreshold() {
  const v = parseInt(localStorage.getItem(STORAGE.threshold), 10);
  return Number.isFinite(v) ? v : DEFAULT_THRESHOLD;
}
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.history));
    if (Array.isArray(raw)) return raw;
  } catch (_) {}
  return [];
}
function persist() {
  localStorage.setItem(STORAGE.categories, JSON.stringify(categories));
  localStorage.setItem(STORAGE.threshold, String(threshold));
  localStorage.setItem(STORAGE.history, JSON.stringify(history));
}

// ---- Scoring ----
function currentTotal() {
  return categories.reduce(
    (sum, c) => sum + (tally[c.id] || 0) * c.points,
    0
  );
}
function isSwipeRight(total) {
  return total >= threshold;
}

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const elCategories = $('categories');
const elTotal = $('totalScore');
const elVerdict = $('verdict');
const elHistory = $('historyList');

// ---- Rendering ----
function renderCategories() {
  elCategories.innerHTML = '';
  categories.forEach((c) => {
    const count = tally[c.id] || 0;
    const card = document.createElement('div');
    card.className = 'cat' + (count > 0 ? ' active' : '');

    const sign = c.points >= 0 ? '+' : '';
    card.innerHTML = `
      <div class="cat-info">
        <div class="cat-name"></div>
        <div class="cat-pts ${c.points >= 0 ? 'pos' : 'neg'}">${sign}${c.points} pts</div>
      </div>
      <button class="step minus" aria-label="minus">−</button>
      <span class="counter">${count}</span>
      <button class="step plus" aria-label="plus">+</button>
    `;
    card.querySelector('.cat-name').textContent = c.name;
    card.querySelector('.plus').addEventListener('click', () => bump(c.id, 1));
    card.querySelector('.minus').addEventListener('click', () => bump(c.id, -1));
    elCategories.appendChild(card);
  });
  renderScore();
}

function renderScore() {
  const total = currentTotal();
  elTotal.textContent = total;
  const yes = isSwipeRight(total);
  elVerdict.textContent = yes ? '💚 Swipe right' : '👎 Swipe left';
  elVerdict.className = 'verdict ' + (yes ? 'yes' : 'no');
}

function bump(id, delta) {
  const next = (tally[id] || 0) + delta;
  tally[id] = Math.max(0, next);
  renderCategories();
}

function renderHistory() {
  elHistory.innerHTML = '';
  if (!history.length) {
    elHistory.innerHTML = '<li class="empty">No profiles rated yet.</li>';
    return;
  }
  history.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const date = new Date(h.timestamp);
    const time = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `
      <div>
        <div class="h-score">${h.total}</div>
        <div class="h-meta">${time}</div>
      </div>
      <span class="badge ${h.swipeRight ? 'yes' : 'no'}">${h.swipeRight ? '💚 right' : '👎 left'}</span>
    `;
    elHistory.appendChild(li);
  });
}

// ---- Profile actions ----
function saveProfile() {
  const total = currentTotal();
  // Skip saving an untouched profile
  if (Object.values(tally).every((n) => !n)) return;
  history.unshift({
    id: Date.now(),
    total,
    swipeRight: isSwipeRight(total),
    timestamp: Date.now(),
    breakdown: { ...tally },
  });
  persist();
  resetCurrent();
  renderHistory();
}
function resetCurrent() {
  tally = {};
  renderCategories();
}

// ---- Settings panel ----
const overlay = $('settingsOverlay');

function openSettings() {
  $('thresholdInput').value = threshold;
  renderSettingsCategories();
  overlay.classList.remove('hidden');
}
function closeSettings() {
  overlay.classList.add('hidden');
}

function renderSettingsCategories() {
  const list = $('settingsCategories');
  list.innerHTML = '';
  categories.forEach((c, idx) => {
    const row = document.createElement('li');
    row.className = 'set-row';
    row.innerHTML = `
      <input class="s-name" type="text" />
      <input class="s-pts" type="number" inputmode="numeric" value="${c.points}" />
      <button class="del" aria-label="delete">🗑</button>
    `;
    const nameInput = row.querySelector('.s-name');
    nameInput.value = c.name;
    nameInput.addEventListener('change', () => {
      categories[idx].name = nameInput.value.trim() || categories[idx].name;
      persist();
    });
    const ptsInput = row.querySelector('.s-pts');
    ptsInput.addEventListener('change', () => {
      const v = parseInt(ptsInput.value, 10);
      categories[idx].points = Number.isFinite(v) ? v : 0;
      persist();
      renderCategories();
    });
    row.querySelector('.del').addEventListener('click', () => {
      categories.splice(idx, 1);
      persist();
      renderSettingsCategories();
      renderCategories();
    });
    list.appendChild(row);
  });
}

function addCategory() {
  const name = $('newCatName').value.trim();
  const pts = parseInt($('newCatPoints').value, 10);
  if (!name || !Number.isFinite(pts)) return;
  categories.push({
    id: 'c' + Date.now(),
    name,
    points: pts,
  });
  $('newCatName').value = '';
  $('newCatPoints').value = '';
  persist();
  renderSettingsCategories();
  renderCategories();
}

function resetDefaults() {
  if (!confirm('Reset categories and threshold to defaults?')) return;
  categories = structuredClone(DEFAULT_CATEGORIES);
  threshold = DEFAULT_THRESHOLD;
  persist();
  $('thresholdInput').value = threshold;
  renderSettingsCategories();
  renderCategories();
}

// ---- Wire up events ----
$('saveProfile').addEventListener('click', saveProfile);
$('resetCurrent').addEventListener('click', resetCurrent);
$('clearHistory').addEventListener('click', () => {
  if (!history.length || !confirm('Clear all history?')) return;
  history = [];
  persist();
  renderHistory();
});
$('settingsToggle').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeSettings();
});
$('thresholdInput').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  threshold = Number.isFinite(v) ? v : DEFAULT_THRESHOLD;
  persist();
  renderScore();
});
$('addCategory').addEventListener('click', addCategory);
$('resetDefaults').addEventListener('click', resetDefaults);

// ---- Init ----
renderCategories();
renderHistory();
