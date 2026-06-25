/* main.js — wires the DOM to the simulation.
 *
 * Owns the game loop (play/pause + speed), the god-power toolbox, the live
 * stats/event panels, the win banner, and the trait editor (persisted to
 * localStorage and applied on Reset).
 */

import { generateMap } from './map.js';
import { defaultCivs } from './civs.js';
import { createWorld } from './sim.js';
import { createRenderer } from './render.js';
import { POWERS, POWER_BY_ID } from './powers.js';

const STORAGE = { traits: 'pr.traits', speed: 'pr.speed', seed: 'pr.seed' };
const PAINTABLE = new Set(['land', 'water', 'mountain', 'forest', 'spawn']);

const $ = (id) => document.getElementById(id);

// ---- Persisted trait overrides ------------------------------------------
function loadCivDefs() {
  const defs = defaultCivs();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.traits));
    if (raw) {
      for (const d of defs) {
        if (raw[d.id]) Object.assign(d.traits, raw[d.id]);
      }
    }
  } catch (_) {}
  return defs;
}
function persistTraits(defs) {
  const obj = {};
  for (const d of defs) obj[d.id] = { ...d.traits };
  localStorage.setItem(STORAGE.traits, JSON.stringify(obj));
}

// ---- Game state ----------------------------------------------------------
let civDefs = loadCivDefs();
let seed = Number(localStorage.getItem(STORAGE.seed)) || ((Math.random() * 1e9) | 0);
let world;
let renderer;
let running = false;
let speed = Number(localStorage.getItem(STORAGE.speed)) || 3;
let tool = 'inspect';
let selectedCiv = 0;

const canvas = $('world');

function freshCivs() {
  // Deep copy so the engine can't mutate our stored definitions.
  return civDefs.map((c) => ({
    ...c,
    traits: { ...c.traits },
    specials: { ...c.specials },
  }));
}

function buildWorld() {
  const map = generateMap(seed);
  world = createWorld({
    tiles: map.tiles,
    civs: freshCivs(),
    starts: map.starts,
    seed,
  });
  renderer = createRenderer(canvas, world);
  renderer.draw();
  renderStats();
  renderLog();
  updateClock();
  updateTicker();
  updatePartyStrip();
  $('winBanner').classList.add('hidden');
  $('tickVal').textContent = '0';
}

// ---- Game loop -----------------------------------------------------------
// Speed slider (1..8) maps to a real ticks-per-second rate, decoupled from the
// 60fps render loop, so 1x is genuinely watchable and 8x is a fast-forward.
const TPS = [1, 2, 3, 5, 8, 12, 18, 28];
const tps = () => TPS[Math.max(0, Math.min(TPS.length - 1, speed - 1))];
let tickAcc = 0;
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min(0.25, (now - lastTime) / 1000); // clamp big gaps
  lastTime = now;
  if (running && world.winner === null) {
    tickAcc += dt * tps();
    let budget = Math.min(tickAcc | 0, 120); // cap catch-up per frame
    tickAcc -= budget;
    while (budget-- > 0 && world.winner === null) world.step();
  }
  renderer.draw();
  $('tickVal').textContent = world.tick;
  updateClock();
  if (world.winner !== null && running) {
    running = false;
    updatePlayBtn();
    showWin();
  }
  requestAnimationFrame(loop);
}

// ---- Game calendar (1 tick = 1 hour) ------------------------------------
function gameTime(ticks) {
  const hour = ticks % 24;
  const totalDays = Math.floor(ticks / 24);
  const day = (totalDays % 30) + 1;
  const totalMonths = Math.floor(totalDays / 30);
  const month = (totalMonths % 12) + 1;
  const year = Math.floor(totalMonths / 12);
  return { hour, day, month, year, decade: Math.floor(year / 10), century: Math.floor(year / 100) };
}
const pad = (n) => String(n).padStart(2, '0');
function formatClock(ticks) {
  const t = gameTime(ticks);
  let era = '';
  if (t.century > 0) era = `Siglo ${t.century + 1} · `;
  else if (t.decade > 0) era = `Década ${t.decade} · `;
  return `📅 ${era}Año ${t.year} · Mes ${t.month} · Día ${t.day} · ${pad(t.hour)}:00`;
}
function formatStamp(ticks) {
  const t = gameTime(ticks);
  return `A${t.year} M${t.month} D${t.day}`;
}

function updateClock() {
  if (world) $('clock').textContent = formatClock(world.tick);
}

function updateTicker() {
  if (!world || !world.events.length) return;
  const e = world.events[0];
  const ticker = $('ticker');
  ticker.textContent = e.text;
  ticker.style.color = e.civ != null ? world.civs[e.civ].color : 'var(--ink)';
}

function updatePartyStrip() {
  const el = $('partyStrip');
  el.innerHTML = '';
  const land = world.landCount || 1;
  world.civs.forEach((c, i) => {
    const s = world.stats[i];
    const pct = Math.round((s.territory / land) * 100);
    const lead = world.leaders[i];
    const chip = document.createElement('span');
    chip.className = 'pchip';
    chip.innerHTML = `<span class="pdot" style="background:${c.color}"></span>` +
      `<b style="color:${c.color}">${c.name.replace('Los ', '')}</b> <b>${pct}%</b>`;
    if (lead) {
      const r = document.createElement('span');
      r.className = 'pruler';
      r.textContent = '👑' + lead.rulerName;
      chip.appendChild(r);
    } else if (s.cities === 0 && s.units === 0) {
      const d = document.createElement('span');
      d.textContent = '†';
      chip.appendChild(d);
    }
    el.appendChild(chip);
  });
  // Neutral free-thinker tally.
  const free = document.createElement('span');
  free.className = 'pchip';
  free.innerHTML = `<span class="pdot" style="background:#9aa6b2"></span>` +
    `<b style="color:#c2cbd4">Librepensadores</b> <b>${world.free ? world.free.length : 0}</b>`;
  el.appendChild(free);
}

// HUD panels refresh on a gentler cadence than the render loop.
setInterval(() => {
  if (world) {
    renderStats();
    renderLog();
    updateTicker();
    updatePartyStrip();
    if (selected) renderInspector();
  }
}, 350);

function updatePlayBtn() {
  $('playBtn').textContent = running ? '⏸ Pausa' : '▶ Jugar';
}

// ---- Stats panel ---------------------------------------------------------
function renderStats() {
  const el = $('stats');
  const land = world.landCount || 1;
  el.innerHTML = '<h2>Partidos</h2>';
  world.civs.forEach((c, i) => {
    const s = world.stats[i];
    const pct = Math.round((s.territory / land) * 100);
    const dead = s.units === 0 && s.cities === 0;
    const wars = [];
    for (let j = 0; j < world.civs.length; j++) {
      if (j !== i && world.war[i][j]) wars.push(`⚔ ${world.civs[j].name.replace('Los ', '')}`);
    }
    const lead = world.leaders[i];
    const ruler = lead ? `👑 ${lead.rulerName}` : '👑 —';
    const card = document.createElement('div');
    card.className = 'civ-card';
    card.style.borderLeftColor = c.color;
    card.innerHTML = `
      <h3 style="color:${c.color}">${c.name}</h3>
      <p class="full">${c.full} · est. ${c.founded}</p>
      <p class="ruler"></p>
      <div class="row"><span>Población</span><span>${s.pop}</span></div>
      <div class="row"><span>Ciudades</span><span>${s.cities}</span></div>
      <div class="row"><span>Territorio</span><span>${pct}%</span></div>
      <div class="bar"><div style="width:${pct}%;background:${c.color}"></div></div>
      <div class="tags">
        ${dead ? '<span class="tag dead">eliminado</span>' : ''}
        ${wars.map((w) => `<span class="tag war">${w}</span>`).join('')}
      </div>
    `;
    card.querySelector('.ruler').textContent = ruler;
    card.querySelector('.ruler').style.color = lead ? '#ffd34d' : 'var(--muted)';
    el.appendChild(card);
  });
}

function renderLog() {
  const el = $('eventLog');
  el.innerHTML = '';
  for (const e of world.events.slice(0, 90)) {
    const li = document.createElement('li');
    const color = e.civ != null ? world.civs[e.civ].color : 'var(--muted)';
    const text = document.createElement('span');
    text.textContent = e.text; // textContent avoids HTML injection from names
    text.style.borderLeft = `3px solid ${color}`;
    text.style.paddingLeft = '8px';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = formatStamp(e.tick);
    li.appendChild(t);
    li.appendChild(text);
    el.appendChild(li);
  }
}

function showWin() {
  const w = world.winner;
  const c = world.civs[w];
  const banner = $('winBanner');
  banner.innerHTML = `<div style="color:${c.color}">👑 ¡${c.name} gobiernan Puerto Rico!</div>` +
    `<small>"${c.motto}"</small>`;
  banner.classList.remove('hidden');
}

// ---- Toolbox (poder + partido en menús desplegables) ---------------------
function buildToolUI() {
  const ps = $('powerSelect');
  ps.innerHTML = '';
  POWERS.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.icon} ${p.label}`;
    ps.appendChild(o);
  });
  ps.value = tool;

  const cs = $('partySelect');
  cs.innerHTML = '';
  civDefs.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = c.name.replace('Los ', '');
    cs.appendChild(o);
  });
  cs.value = String(selectedCiv);
  updateToolUI();
}

function updateToolUI() {
  const p = POWER_BY_ID[tool];
  $('partyPickWrap').style.display = p.needsCiv ? '' : 'none';
  updateHint();
}

function updateHint() {
  const p = POWER_BY_ID[tool];
  const needsCiv = p.needsCiv ? ` (partido: ${civDefs[selectedCiv].name})` : '';
  $('toolHint').textContent = `${p.icon} ${p.label}: ${p.desc}${needsCiv}`;
}

$('powerSelect').addEventListener('change', (e) => { tool = e.target.value; updateToolUI(); });
$('partySelect').addEventListener('change', (e) => { selectedCiv = Number(e.target.value); updateHint(); });

function applyTool(clientX, clientY) {
  const { x, y } = renderer.screenToTile(clientX, clientY);
  const p = POWER_BY_ID[tool];
  if (!p || p.id === 'inspect') return;
  p.apply(world, x, y, selectedCiv);
  if (['land', 'water', 'mountain', 'forest', 'meteor', 'hurricane', 'volcano'].includes(tool)) {
    renderer.markTerrainDirty();
  }
  renderer.draw();
  renderStats();
  renderLog();
}

// ---- Pointer handling: 1 finger = tool (or pan with Inspect),
//      2 fingers = pinch-zoom + pan; mouse wheel = zoom. -------------------
const pointers = new Map();
let pinch = null;
let lastSingle = null;

function pinchState() {
  const ps = [...pointers.values()];
  const a = ps[0], b = ps[1];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
}

let tap = null; // tracks a candidate tap for click-to-inspect (Look tool)

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    lastSingle = { x: e.clientX, y: e.clientY };
    tap = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    if (tool !== 'inspect') applyTool(e.clientX, e.clientY);
  } else if (pointers.size === 2) {
    pinch = pinchState();
    lastSingle = null;
    tap = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap.moved = true;
  if (pointers.size >= 2) {
    const ns = pinchState();
    if (pinch) {
      if (pinch.dist > 0) renderer.zoomAtClient(ns.midX, ns.midY, ns.dist / pinch.dist);
      renderer.panByClient(ns.midX - pinch.midX, ns.midY - pinch.midY);
    }
    pinch = ns;
  } else if (pointers.size === 1) {
    if (tool === 'inspect') {
      if (lastSingle) renderer.panByClient(e.clientX - lastSingle.x, e.clientY - lastSingle.y);
      lastSingle = { x: e.clientX, y: e.clientY };
    } else if (PAINTABLE.has(tool)) {
      applyTool(e.clientX, e.clientY);
    }
  }
});
function endPointer(e) {
  // A clean tap with the Look tool selects a character/city to inspect.
  if (tool === 'inspect' && tap && e.pointerId === tap.id && !tap.moved && pointers.size === 1) {
    inspectAt(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) { lastSingle = null; tap = null; }
  else { const p = [...pointers.values()][0]; lastSingle = { x: p.x, y: p.y }; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAtClient(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

// Zoom buttons (desktop fallback).
$('zoomIn').addEventListener('click', () => renderer.zoomByCenter(1.3));
$('zoomOut').addEventListener('click', () => renderer.zoomByCenter(0.77));
$('zoomFit').addEventListener('click', () => renderer.fit());

// ---- Inspector (tap a character/city with the Look tool) -----------------
let selected = null; // { kind: 'unit'|'city', ref }
const RULER_TITLE = { pnp: 'Gobernador', ppd: 'Gobernador', ind: 'Líder' };

function inspectAt(clientX, clientY) {
  const { x, y } = renderer.screenToTile(clientX, clientY);
  const u = world.unitAt(x, y);
  if (u) { selected = { kind: 'unit', ref: u }; renderInspector(); return; }
  const c = world.cityAtTile(x, y);
  if (c) { selected = { kind: 'city', ref: c }; renderInspector(); return; }
  selected = null;
  $('inspector').classList.add('hidden');
}

function bar(frac, color) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return `<div class="ibar"><div style="width:${pct}%;background:${color}"></div></div>`;
}

function renderInspector() {
  const el = $('inspector');
  if (!selected) { el.classList.add('hidden'); return; }
  const body = $('inspBody');
  const years = (ticks) => Math.floor(ticks / 5);

  if (selected.kind === 'unit') {
    const u = selected.ref;
    const c = world.civs[u.civ];
    const crown = u.isLeader ? '👑 ' : '';
    const role = u.isLeader
      ? `${RULER_TITLE[c.id] || 'Líder'}`
      : 'Ciudadano';
    const name = u.isLeader ? u.rulerName : `${role} de ${c.name.replace('Los ', '')}`;
    const dead = u.dead ? `<div class="idead">† Cayó en combate</div>` : '';
    const reign = u.isLeader ? `<div class="irow"><span>Reinado</span><span>${years(world.tick - u.since)} años</span></div>` : '';
    body.innerHTML = `
      <div class="ihead">
        <span class="iface" style="background:${c.color}">${crown || '🧍'}</span>
        <div>
          <div class="iname" style="color:${c.color}">${''}</div>
          <div class="ipart">${c.name}</div>
        </div>
      </div>
      ${dead}
      <div class="irow"><span>Cargo</span><span>${crown ? (RULER_TITLE[c.id] || 'Líder') : 'Ciudadano'}</span></div>
      <div class="irow"><span>Edad</span><span>${years(u.age)} años</span></div>
      <div class="irow"><span>Salud</span><span>${Math.max(0, Math.round(u.hp))}/${Math.round(u.maxHp)}</span></div>
      ${bar(u.hp / u.maxHp, '#3fd96b')}
      <div class="irow"><span>Bajas</span><span>⚔ ${u.kills}</span></div>
      ${reign}
    `;
    body.querySelector('.iname').textContent = name;
  } else {
    const c = selected.ref;
    const civ = world.civs[c.civ];
    body.innerHTML = `
      <div class="ihead">
        <span class="iface" style="background:${civ.color}">🏙️</span>
        <div>
          <div class="iname" style="color:${civ.color}"></div>
          <div class="ipart">${civ.name}</div>
        </div>
      </div>
      <div class="irow"><span>Municipio</span><span>${''}</span></div>
      <div class="irow"><span>Población</span><span>${Math.round(c.pop)}</span></div>
      <div class="irow"><span>Salud</span><span>${Math.max(0, Math.round(c.hp))}/${Math.round(c.maxHp)}</span></div>
      ${bar(c.hp / c.maxHp, '#3fd96b')}
      <div class="irow"><span>Lealtad</span><span>${Math.round(c.loyalty)}%</span></div>
    `;
    body.querySelector('.iname').textContent = c.name;
    body.querySelectorAll('.irow span:last-child')[0].textContent = c.muni || '—';
  }
  el.classList.remove('hidden');
}

$('inspClose').addEventListener('click', () => { selected = null; $('inspector').classList.add('hidden'); });

// ---- Trait editor --------------------------------------------------------
function renderTraitEditor() {
  const el = $('traitEditor');
  el.innerHTML = '';
  const traitNames = ['aggression', 'brutality', 'intelligence', 'expansion', 'growth', 'diplomacy', 'resilience'];
  const traitLabel = {
    aggression: 'agresión', brutality: 'brutalidad', intelligence: 'inteligencia',
    expansion: 'expansión', growth: 'crecimiento', diplomacy: 'diplomacia', resilience: 'resiliencia',
  };
  civDefs.forEach((c) => {
    const box = document.createElement('div');
    box.className = 'trait-civ';
    box.innerHTML = `<h3 style="color:${c.color}">${c.name}</h3>`;
    traitNames.forEach((tn) => {
      const row = document.createElement('div');
      row.className = 'trait-row';
      row.innerHTML = `<label>${traitLabel[tn]}</label>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '10';
      input.step = '1';
      input.value = c.traits[tn];
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = c.traits[tn];
      input.addEventListener('input', () => {
        c.traits[tn] = Number(input.value);
        v.textContent = input.value;
        persistTraits(civDefs);
      });
      row.appendChild(input);
      row.appendChild(v);
      box.appendChild(row);
    });
    el.appendChild(box);
  });
}

// ---- Wire up controls ----------------------------------------------------
$('playBtn').addEventListener('click', () => {
  if (world.winner !== null) return;
  running = !running;
  updatePlayBtn();
});
$('stepBtn').addEventListener('click', () => {
  if (world.winner === null) world.step();
  renderer.draw();
  $('tickVal').textContent = world.tick;
  renderStats();
  renderLog();
});
$('resetBtn').addEventListener('click', () => {
  running = false;
  seed = (Math.random() * 1e9) | 0;
  localStorage.setItem(STORAGE.seed, String(seed));
  civDefs = loadCivDefs();
  buildWorld();
  renderTraitEditor();
  updatePlayBtn();
});
$('speed').addEventListener('input', (e) => {
  speed = Number(e.target.value);
  $('speedVal').textContent = speed + '× · ' + tps() + '/s';
  localStorage.setItem(STORAGE.speed, String(speed));
});

$('settingsToggle').addEventListener('click', () => {
  renderTraitEditor();
  $('settingsOverlay').classList.remove('hidden');
});
$('settingsClose').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
$('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === $('settingsOverlay')) $('settingsOverlay').classList.add('hidden');
});
$('resetTraits').addEventListener('click', () => {
  localStorage.removeItem(STORAGE.traits);
  civDefs = defaultCivs();
  persistTraits(civDefs);
  renderTraitEditor();
});

// ---- Init ----------------------------------------------------------------
$('speed').value = speed;
$('speedVal').textContent = speed + '× · ' + tps() + '/s';
buildWorld();
buildToolUI();
updatePlayBtn();
requestAnimationFrame(loop);
