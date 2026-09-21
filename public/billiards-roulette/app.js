/* Billiards Roulette — customizable spinning wheels for pool night: one
 * picks the game, one picks the style we play it with, and one picks which
 * pocket the ball has to go in for the games that call for it.
 * All state lives in localStorage; no backend involved.
 * Depends on wheel.js (RouletteWheel + Rand) being loaded first. */
'use strict';

const STORAGE = {
  wheels: 'br.wheels',
  history: 'br.history',
  sound: 'br.sound',
};
const HISTORY_LIMIT = 30;
const NAME_MAX = 40;
const TITLE_MAX = 30;
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 10;

/* Every wheel: { id, title, hint, optional, inCombo, noRepeat, drawn, entries }.
 * Every entry: { id, name, weight (1–10 = slice size / odds), enabled }.
 * `inCombo` says whether the wheel joins the big "spin them together"
 * button — a wheel that only matters in some games (the pocket wheel) ships
 * with it off and is spun on its own when the situation comes up.
 * Adding another wheel to this list is all it takes to get a fourth one
 * rendered, edited and spun alongside the others. */
const DEFAULT_WHEELS = [
  {
    id: 'game',
    title: 'Game',
    hint: 'Which billiards game we play',
    entries: seed('game', [
      '8-Ball',
      '9-Ball',
      '10-Ball',
      'Enchulao',
      'One-Pocket',
      'Bank Pool',
    ]),
  },
  {
    id: 'style',
    title: 'Play Style',
    hint: 'The twist we play it with',
    entries: seed('style', [
      'Standard rules',
      'Opposite hand',
      'Banks only',
      'Last Ball Jump Shot',
      'Only Combination Shots',
      'Scratch and Done',
      'Soft Brack Standard',
      'Opponent Chooses Pocket every shot',
      'Color Code',
      'Clockwise Pocketing',
      'Only Middle Pocket',
      'No Defense',
      'Crazy Rack',
      'No chalk',
    ]),
  },
  {
    id: 'pocket',
    title: 'Pocket',
    hint: 'Which pocket the ball has to go in. Head is the end you break from, foot is the end the rack sits on.',
    // Only some games and situations call for a pocket draw, so this wheel
    // sits out of the big spin until you switch it in.
    optional: true,
    inCombo: false,
    entries: seed('pocket', [
      'Left head corner',
      'Right head corner',
      'Left side',
      'Right side',
      'Left foot corner',
      'Right foot corner',
    ]),
  },
];

function seed(prefix, names) {
  return names.map((name, i) => ({ id: `${prefix}-d${i}`, name, weight: 1, enabled: true }));
}

// ---- Helpers ----
const $ = (id) => document.getElementById(id);
const q = (root, sel) => root.querySelector(sel);

function uid() {
  return 'e' + Date.now().toString(36) + Rand.int(1679616).toString(36).padStart(4, '0');
}
function clampWeight(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, n)) : WEIGHT_MIN;
}
function cleanName(v, max = NAME_MAX) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function activeEntries(wheel) {
  return wheel.entries.filter((e) => e.enabled);
}

/* Two-tap confirmation for destructive buttons: the first tap arms the
 * button for a few seconds and relabels it, the second tap runs the action.
 * Unlike a confirm() dialog, this works on phones and inside embedded frames. */
function armConfirm(btn, action, armedText) {
  if (btn.dataset.armed === '1') {
    disarm(btn);
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent;
  btn.textContent = armedText;
  btn.classList.add('armed');
  btn._disarmTimer = setTimeout(() => disarm(btn), 4000);
}
function disarm(btn) {
  clearTimeout(btn._disarmTimer);
  if (btn.dataset.armed !== '1') return;
  btn.dataset.armed = '0';
  btn.textContent = btn.dataset.label;
  btn.classList.remove('armed');
}
function defaultsFor(wheelId) {
  return DEFAULT_WHEELS.find((w) => w.id === wheelId);
}

// ---- Persistence ----
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name,
    weight: clampWeight(raw.weight ?? 1),
    enabled: raw.enabled !== false,
  };
}
function loadWheels() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE.wheels));
  } catch (_) {}
  const byId = new Map();
  if (Array.isArray(saved)) {
    for (const w of saved) if (w && typeof w.id === 'string') byId.set(w.id, w);
  }
  return DEFAULT_WHEELS.map((def) => {
    const base = {
      id: def.id,
      title: def.title,
      hint: def.hint,
      optional: Boolean(def.optional),
      inCombo: def.inCombo !== false,
      noRepeat: false,
      drawn: [],
      entries: structuredClone(def.entries),
    };
    const s = byId.get(def.id);
    if (!s) return base;
    const entries = Array.isArray(s.entries) ? s.entries.map(normalizeEntry).filter(Boolean) : base.entries;
    const ids = new Set(entries.map((e) => e.id));
    return {
      ...base,
      title: cleanName(s.title, TITLE_MAX) || def.title,
      inCombo: typeof s.inCombo === 'boolean' ? s.inCombo : base.inCombo,
      noRepeat: Boolean(s.noRepeat),
      drawn: Array.isArray(s.drawn) ? s.drawn.filter((id) => ids.has(id)) : [],
      entries,
    };
  });
}
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.history));
    if (Array.isArray(raw)) {
      return raw
        .filter((h) => h && Array.isArray(h.parts) && Number.isFinite(h.t))
        .slice(0, HISTORY_LIMIT);
    }
  } catch (_) {}
  return [];
}
function persist() {
  try {
    localStorage.setItem(STORAGE.wheels, JSON.stringify(wheels));
    localStorage.setItem(STORAGE.history, JSON.stringify(spinLog));
    localStorage.setItem(STORAGE.sound, Sound.enabled ? 'on' : 'off');
  } catch (_) {
    /* private mode / quota — the session still works, it just isn't remembered */
  }
}

// ---- Sound (tiny WebAudio clicks; nothing to download) ----
const Sound = {
  enabled: localStorage.getItem(STORAGE.sound) !== 'off',
  ctx: null,
  unlock() {
    if (!this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (_) {
      this.ctx = null;
    }
  },
  tick() {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.05);
  },
  win() {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const t = c.currentTime + i * 0.11;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.36);
    });
  },
};

// ---- State ----
let wheels = loadWheels();
let spinLog = loadHistory();
const views = []; // one per wheel: { wheel, els, rw }
let spinsInFlight = 0;

// ---- DOM refs ----
const wheelsEl = $('wheels');
const template = $('wheelTemplate');
const spinAllBtn = $('spinAll');
const comboEl = $('comboResult');
const historyEl = $('historyList');
const soundBtn = $('soundToggle');

// ---- Building a wheel card ----
function buildView(wheel) {
  const frag = template.content.cloneNode(true);
  const root = q(frag, '.wheel-card');
  const els = {
    root,
    title: q(root, '.wheel-title'),
    hint: q(root, '.wheel-hint'),
    count: q(root, '.wheel-count'),
    canvas: q(root, '.wheel-canvas'),
    empty: q(root, '.wheel-empty'),
    pointer: q(root, '.pointer'),
    result: q(root, '.wheel-result'),
    spinBtn: q(root, '.spin-btn'),
    editToggle: q(root, '.edit-toggle'),
    inCombo: q(root, '.in-combo'),
    optionalBadge: q(root, '.optional-badge'),
    editor: q(root, '.editor'),
    list: q(root, '.entry-list'),
    newName: q(root, '.new-name'),
    addBtn: q(root, '.add-btn'),
    bulk: q(root, '.bulk'),
    bulkText: q(root, '.bulk-text'),
    bulkApply: q(root, '.bulk-apply'),
    noRepeat: q(root, '.no-repeat'),
    resetBtn: q(root, '.reset-btn'),
  };
  root.dataset.wheel = wheel.id;
  const rw = new RouletteWheel(els.canvas, {
    onTick: () => {
      Sound.tick();
      nudgePointer(els.pointer);
    },
  });
  const view = { wheel, els, rw };

  els.title.value = wheel.title;
  els.title.maxLength = TITLE_MAX;
  els.hint.textContent = wheel.hint;
  els.canvas.setAttribute('aria-label', `Spin the ${wheel.title} wheel`);
  els.noRepeat.checked = wheel.noRepeat;
  els.inCombo.checked = wheel.inCombo;
  els.optionalBadge.hidden = !wheel.optional;

  els.inCombo.addEventListener('change', () => {
    wheel.inCombo = els.inCombo.checked;
    persist();
    updateSpinAll();
  });

  els.title.addEventListener('change', () => {
    wheel.title = cleanName(els.title.value, TITLE_MAX) || defaultsFor(wheel.id).title;
    els.title.value = wheel.title;
    els.canvas.setAttribute('aria-label', `Spin the ${wheel.title} wheel`);
    persist();
    updateSpinAll();
  });
  els.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.title.blur();
  });

  els.spinBtn.addEventListener('click', () => spinWheel(view));
  els.canvas.addEventListener('click', () => spinWheel(view));
  els.canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      spinWheel(view);
    }
  });

  els.editToggle.addEventListener('click', () => {
    const open = els.editor.hidden;
    els.editor.hidden = !open;
    els.editToggle.setAttribute('aria-expanded', String(open));
    els.editToggle.classList.toggle('active', open);
    if (open) renderEntries(view);
  });

  els.addBtn.addEventListener('click', () => addEntry(view));
  els.newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry(view);
    }
  });

  els.bulk.addEventListener('toggle', () => {
    if (els.bulk.open) els.bulkText.value = toBulkText(wheel);
  });
  els.bulkApply.addEventListener('click', () => {
    const parsed = parseBulk(els.bulkText.value, wheel);
    const apply = () => {
      wheel.entries = parsed;
      wheel.drawn = [];
      persist();
      renderEntries(view);
      syncWheel(view);
      els.bulk.open = false;
    };
    if (parsed.length) apply();
    else armConfirm(els.bulkApply, apply, 'Tap again to empty the wheel');
  });

  els.noRepeat.addEventListener('change', () => {
    wheel.noRepeat = els.noRepeat.checked;
    wheel.drawn = [];
    persist();
    syncWheel(view);
  });

  els.resetBtn.addEventListener('click', () => {
    armConfirm(
      els.resetBtn,
      () => {
        const def = defaultsFor(wheel.id);
        wheel.title = def.title;
        wheel.entries = structuredClone(def.entries);
        wheel.drawn = [];
        els.title.value = wheel.title;
        persist();
        renderEntries(view);
        syncWheel(view);
      },
      'Tap again to reset this wheel'
    );
  });

  wheelsEl.appendChild(frag);
  syncWheel(view);
  return view;
}

/* Push the wheel's current option list into the canvas + status labels. */
function syncWheel(view) {
  const { wheel, els, rw } = view;
  const active = activeEntries(wheel);
  rw.setSlices(active.map((e) => ({ id: e.id, label: e.name, weight: e.weight })));
  // The wheel drops its lit winner when the options actually changed — the
  // result text under it should never outlive the slice it came from.
  if (rw.highlight < 0) {
    els.result.textContent = '';
    els.result.classList.remove('pop');
  }
  updateStatus(view);
  refreshSwatches(view);
}

/* Status line, empty state and spin button — cheap enough to run after
 * every spin without touching the canvas. */
function updateStatus(view) {
  const { wheel, els } = view;
  const active = activeEntries(wheel);
  const total = wheel.entries.length;
  let text;
  if (!total) text = 'No options yet';
  else if (active.length === total) text = `${total} option${total === 1 ? '' : 's'}`;
  else text = `${active.length} of ${total} in play`;
  if (wheel.noRepeat && active.length) {
    const drawn = new Set(wheel.drawn);
    const left = active.filter((e) => !drawn.has(e.id)).length || active.length;
    text += ` · ${left} left this round`;
  }
  els.count.textContent = text;
  els.empty.hidden = active.length > 0;
  els.spinBtn.disabled = spinsInFlight > 0 || !active.length;
  els.root.classList.toggle('is-empty', !active.length);
  updateSpinAll();
}

// ---- Option editor ----
function renderEntries(view) {
  const { wheel, els } = view;
  els.list.innerHTML = '';
  if (!wheel.entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing here yet — add an option below.';
    els.list.appendChild(li);
    return;
  }
  wheel.entries.forEach((entry) => {
    const row = document.createElement('li');
    row.className = 'entry-row';
    row.dataset.id = entry.id;
    row.innerHTML = `
      <span class="swatch" aria-hidden="true"></span>
      <input class="e-name" type="text" maxlength="${NAME_MAX}" aria-label="Option name" />
      <label class="e-weight-wrap" title="Odds: slice size relative to the others (1–10)">
        <span>×</span>
        <input class="e-weight" type="number" inputmode="numeric" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" aria-label="Odds weight" />
      </label>
      <label class="e-on-wrap" title="Include in spins">
        <input class="e-on" type="checkbox" aria-label="Include in spins" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <button class="del" type="button" aria-label="Delete option">🗑</button>
    `;
    const nameInput = q(row, '.e-name');
    const weightInput = q(row, '.e-weight');
    const onInput = q(row, '.e-on');
    nameInput.value = entry.name;
    weightInput.value = entry.weight;
    onInput.checked = entry.enabled;
    row.classList.toggle('off', !entry.enabled);

    nameInput.addEventListener('change', () => {
      const name = cleanName(nameInput.value);
      if (name) entry.name = name;
      nameInput.value = entry.name;
      persist();
      syncWheel(view);
    });
    weightInput.addEventListener('change', () => {
      entry.weight = clampWeight(weightInput.value);
      weightInput.value = entry.weight;
      persist();
      syncWheel(view);
    });
    onInput.addEventListener('change', () => {
      entry.enabled = onInput.checked;
      row.classList.toggle('off', !entry.enabled);
      if (!entry.enabled) wheel.drawn = wheel.drawn.filter((id) => id !== entry.id);
      persist();
      syncWheel(view);
    });
    q(row, '.del').addEventListener('click', () => {
      wheel.entries = wheel.entries.filter((e) => e !== entry);
      wheel.drawn = wheel.drawn.filter((id) => id !== entry.id);
      persist();
      renderEntries(view);
      syncWheel(view);
    });
    els.list.appendChild(row);
  });
  refreshSwatches(view);
}

/* Colour dots in the editor mirror each option's slice on the wheel. */
function refreshSwatches(view) {
  const { wheel, els } = view;
  const active = activeEntries(wheel);
  const rows = els.list.querySelectorAll('.entry-row');
  rows.forEach((row) => {
    const entry = wheel.entries.find((e) => e.id === row.dataset.id);
    const sw = q(row, '.swatch');
    if (!entry || !sw) return;
    const idx = active.indexOf(entry);
    sw.style.background = idx >= 0 ? RouletteWheel.colorFor(idx, active.length).fill : 'transparent';
    sw.classList.toggle('off', idx < 0);
  });
}

function addEntry(view) {
  const { wheel, els } = view;
  const name = cleanName(els.newName.value);
  if (!name) {
    els.newName.focus();
    return;
  }
  wheel.entries.push({ id: uid(), name, weight: 1, enabled: true });
  els.newName.value = '';
  persist();
  renderEntries(view);
  syncWheel(view);
  els.newName.focus();
}

/* Bulk format, one option per line:  Name  |  Name | 3  |  Name | 3 | off */
function toBulkText(wheel) {
  return wheel.entries
    .map((e) => {
      let line = e.name;
      if (e.weight !== 1 || !e.enabled) line += ` | ${e.weight}`;
      if (!e.enabled) line += ' | off';
      return line;
    })
    .join('\n');
}
function parseBulk(text, wheel) {
  const byName = new Map(wheel.entries.map((e) => [e.name.toLowerCase(), e]));
  const usedIds = new Set();
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const parts = raw.split('|').map((s) => cleanName(s));
    const name = parts[0];
    if (!name) continue;
    const prev = byName.get(name.toLowerCase());
    const reuse = prev && !usedIds.has(prev.id) ? prev : null;
    if (reuse) usedIds.add(reuse.id);
    const flags = parts.slice(1);
    const num = flags.map((f) => parseInt(f, 10)).find((n) => Number.isFinite(n));
    const off = flags.some((f) => /^(off|no|skip)$/i.test(f));
    out.push({
      id: reuse ? reuse.id : uid(),
      name,
      weight: clampWeight(Number.isFinite(num) ? num : reuse ? reuse.weight : 1),
      enabled: !off,
    });
  }
  return out;
}

// ---- Spinning ----
function setBusy(delta) {
  spinsInFlight = Math.max(0, spinsInFlight + delta);
  const busy = spinsInFlight > 0;
  document.body.classList.toggle('busy', busy);
  for (const v of views) {
    v.els.spinBtn.disabled = busy || !activeEntries(v.wheel).length;
    v.els.editor.disabled = busy;
    v.els.title.disabled = busy;
    v.els.inCombo.disabled = busy;
  }
  updateSpinAll();
}

/* The wheels currently switched into the big spin. */
function comboViews() {
  return views.filter((v) => v.wheel.inCombo);
}

/* The big button names exactly what it will spin, so nobody has to guess
 * whether the pocket wheel is in play this game. */
function updateSpinAll() {
  const included = comboViews();
  const ready = included.filter((v) => activeEntries(v.wheel).length);
  let label;
  if (!included.length) label = 'Switch a wheel into the big spin';
  else if (included.length === 1) label = `🎲 Spin the ${included[0].wheel.title} wheel`;
  else if (included.length === 2) label = '🎲 Spin both wheels';
  else label = `🎲 Spin all ${included.length} wheels`;
  spinAllBtn.textContent = label;
  spinAllBtn.disabled = spinsInFlight > 0 || !ready.length;
}

/* Choose the winner (index within `active`). Pure crypto randomness by
 * default; with "no repeats" on, options already drawn this round are
 * excluded until every option has come up once. */
function pickIndex(wheel, active) {
  let pool = active;
  if (wheel.noRepeat) {
    const drawn = new Set(wheel.drawn);
    pool = active.filter((e) => !drawn.has(e.id));
    if (!pool.length) {
      // New round — and don't open it with the option that just came up.
      const last = wheel.drawn[wheel.drawn.length - 1];
      wheel.drawn = [];
      pool = active.length > 1 ? active.filter((e) => e.id !== last) : active;
    }
  }
  const pick = pool[Rand.weighted(pool.map((e) => e.weight))];
  if (wheel.noRepeat) wheel.drawn.push(pick.id);
  return active.indexOf(pick);
}

async function spinWheel(view, { record = true, jingle = true } = {}) {
  const { wheel, els, rw } = view;
  const active = activeEntries(wheel);
  if (!active.length || rw.spinning || (spinsInFlight > 0 && record)) return null;
  const index = pickIndex(wheel, active);
  persist();
  Sound.unlock();
  setBusy(+1);
  if (record) hideCombo();
  els.result.textContent = '';
  els.result.classList.remove('pop');
  els.root.classList.add('spinning');

  const res = await rw.spin(index);

  els.root.classList.remove('spinning');
  const entry = active[res.index];
  els.result.textContent = entry.name;
  els.result.classList.add('pop');
  if (jingle) Sound.win();
  if (record) addHistory([{ wheel: wheel.title, name: entry.name }]);
  setBusy(-1);
  updateStatus(view);
  return { wheel, entry };
}

async function spinAll() {
  if (spinsInFlight > 0) return;
  const ready = comboViews().filter((v) => activeEntries(v.wheel).length && !v.rw.spinning);
  if (!ready.length) return;
  hideCombo();
  const results = await Promise.all(ready.map((v) => spinWheel(v, { record: false, jingle: false })));
  const parts = results.filter(Boolean).map((r) => ({ wheel: r.wheel.title, name: r.entry.name }));
  if (!parts.length) return;
  Sound.win();
  showCombo(parts);
  addHistory(parts);
}

function nudgePointer(el) {
  el.classList.remove('tick');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('tick');
}

// ---- Combined result + history ----
function renderParts(parts) {
  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '+';
      frag.appendChild(sep);
    }
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('small');
    label.textContent = p.wheel;
    const name = document.createElement('b');
    name.textContent = p.name;
    chip.append(label, name);
    frag.appendChild(chip);
  });
  return frag;
}
function showCombo(parts) {
  comboEl.innerHTML = '';
  const lead = document.createElement('span');
  lead.className = 'combo-lead';
  lead.textContent = 'Tonight we play';
  comboEl.append(lead, renderParts(parts));
  comboEl.hidden = false;
  comboEl.classList.remove('pop');
  void comboEl.offsetWidth;
  comboEl.classList.add('pop');
}
function hideCombo() {
  comboEl.hidden = true;
}

function addHistory(parts) {
  spinLog.unshift({ t: Date.now(), parts });
  if (spinLog.length > HISTORY_LIMIT) spinLog.length = HISTORY_LIMIT;
  persist();
  renderHistory();
}
function renderHistory() {
  historyEl.innerHTML = '';
  if (!spinLog.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No spins yet. Give it a whirl.';
    historyEl.appendChild(li);
    return;
  }
  spinLog.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const time = document.createElement('span');
    time.className = 'h-time';
    time.textContent = new Date(h.t).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const body = document.createElement('span');
    body.className = 'h-parts';
    body.appendChild(renderParts(h.parts));
    li.append(body, time);
    historyEl.appendChild(li);
  });
}

// ---- Sound toggle ----
function renderSoundBtn() {
  soundBtn.textContent = Sound.enabled ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(Sound.enabled));
  soundBtn.setAttribute('aria-label', Sound.enabled ? 'Sound on — tap to mute' : 'Sound off — tap to unmute');
  soundBtn.title = Sound.enabled ? 'Mute' : 'Unmute';
}

// ---- Wire up ----
spinAllBtn.addEventListener('click', spinAll);
$('clearHistory').addEventListener('click', () => {
  if (!spinLog.length) return;
  armConfirm(
    $('clearHistory'),
    () => {
      spinLog = [];
      persist();
      renderHistory();
    },
    'Tap again to clear'
  );
});
soundBtn.addEventListener('click', () => {
  Sound.enabled = !Sound.enabled;
  if (Sound.enabled) Sound.unlock();
  persist();
  renderSoundBtn();
});

// ---- Init ----
for (const wheel of wheels) views.push(buildView(wheel));
setBusy(0);
renderHistory();
renderSoundBtn();
if (!Rand.secure) $('randNote').textContent = 'This browser has no crypto random source; falling back to Math.random().';

// Exposed for debugging / automated tests only.
window.__billiardsRoulette = { views, wheels, Rand };
