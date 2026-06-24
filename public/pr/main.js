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
  $('winBanner').classList.add('hidden');
  $('tickVal').textContent = '0';
}

// ---- Game loop -----------------------------------------------------------
// Speed slider (1..8) maps to a real ticks-per-second rate, decoupled from the
// 60fps render loop, so 1x is genuinely watchable and 8x is a fast-forward.
const TPS = [6, 10, 15, 22, 30, 42, 56, 75];
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
  if (world.winner !== null && running) {
    running = false;
    updatePlayBtn();
    showWin();
  }
  requestAnimationFrame(loop);
}

// HUD panels refresh on a gentler cadence than the render loop.
setInterval(() => {
  if (world) { renderStats(); renderLog(); }
}, 350);

function updatePlayBtn() {
  $('playBtn').textContent = running ? '⏸ Pause' : '▶ Play';
}

// ---- Stats panel ---------------------------------------------------------
function renderStats() {
  const el = $('stats');
  const land = world.landCount || 1;
  el.innerHTML = '<h2>Parties</h2>';
  world.civs.forEach((c, i) => {
    const s = world.stats[i];
    const pct = Math.round((s.territory / land) * 100);
    const dead = s.units === 0 && s.cities === 0;
    const wars = [];
    for (let j = 0; j < world.civs.length; j++) {
      if (j !== i && world.war[i][j]) wars.push(`⚔ ${world.civs[j].name.replace('Los ', '')}`);
    }
    const card = document.createElement('div');
    card.className = 'civ-card';
    card.style.borderLeftColor = c.color;
    card.innerHTML = `
      <h3 style="color:${c.color}">${c.name}</h3>
      <p class="full">${c.full} · est. ${c.founded}</p>
      <div class="row"><span>Population</span><span>${s.pop}</span></div>
      <div class="row"><span>Cities</span><span>${s.cities}</span></div>
      <div class="row"><span>Territory</span><span>${pct}%</span></div>
      <div class="bar"><div style="width:${pct}%;background:${c.color}"></div></div>
      <div class="tags">
        ${dead ? '<span class="tag dead">eliminated</span>' : ''}
        ${wars.map((w) => `<span class="tag war">${w}</span>`).join('')}
      </div>
    `;
    el.appendChild(card);
  });
}

function renderLog() {
  const el = $('eventLog');
  el.innerHTML = '';
  for (const e of world.events.slice(0, 90)) {
    const li = document.createElement('li');
    const color = e.civ != null ? world.civs[e.civ].color : 'var(--muted)';
    // tick reads as an in-world "year" for flavor
    const year = 'Año ' + e.tick;
    const text = document.createElement('span');
    text.textContent = e.text; // textContent avoids HTML injection from names
    text.style.borderLeft = `3px solid ${color}`;
    text.style.paddingLeft = '6px';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = year;
    li.appendChild(t);
    li.appendChild(text);
    el.appendChild(li);
  }
}

function showWin() {
  const w = world.winner;
  const c = world.civs[w];
  const banner = $('winBanner');
  banner.innerHTML = `<div style="color:${c.color}">👑 ${c.name} rule Puerto Rico!</div>` +
    `<small>"${c.motto}"</small>`;
  banner.classList.remove('hidden');
}

// ---- Toolbox -------------------------------------------------------------
function renderTools() {
  const picker = $('civPicker');
  picker.innerHTML = '';
  civDefs.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'civ-chip' + (i === selectedCiv ? ' active' : '');
    b.dataset.civ = c.id;
    b.textContent = c.name.replace('Los ', '');
    b.style.color = c.color;
    b.addEventListener('click', () => { selectedCiv = i; renderTools(); });
    picker.appendChild(b);
  });

  const list = $('powerList');
  list.innerHTML = '';
  POWERS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'power-btn' + (p.id === tool ? ' active' : '');
    b.innerHTML = `<span class="ic">${p.icon}</span>${p.label}`;
    b.addEventListener('click', () => { tool = p.id; updateHint(); renderTools(); });
    list.appendChild(b);
  });
  updateHint();
}

function updateHint() {
  const p = POWER_BY_ID[tool];
  const needsCiv = p.needsCiv ? ` (party: ${civDefs[selectedCiv].name})` : '';
  $('toolHint').textContent = `${p.icon} ${p.label}: ${p.desc}${needsCiv}`;
}

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

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    lastSingle = { x: e.clientX, y: e.clientY };
    if (tool !== 'inspect') applyTool(e.clientX, e.clientY);
  } else if (pointers.size === 2) {
    pinch = pinchState();
    lastSingle = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) lastSingle = null;
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

// ---- Trait editor --------------------------------------------------------
function renderTraitEditor() {
  const el = $('traitEditor');
  el.innerHTML = '';
  const traitNames = ['aggression', 'brutality', 'intelligence', 'expansion', 'growth', 'diplomacy', 'resilience'];
  civDefs.forEach((c) => {
    const box = document.createElement('div');
    box.className = 'trait-civ';
    box.innerHTML = `<h3 style="color:${c.color}">${c.name}</h3>`;
    traitNames.forEach((tn) => {
      const row = document.createElement('div');
      row.className = 'trait-row';
      row.innerHTML = `<label>${tn}</label>`;
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
renderTools();
updatePlayBtn();
requestAnimationFrame(loop);
