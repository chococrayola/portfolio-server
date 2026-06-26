/* main.js — wires the DOM to the simulation.
 *
 * Owns the game loop (play/pause + speed), the god-power toolbox, the live
 * stats/event panels, the win banner, and the trait editor (persisted to
 * localStorage and applied on Reset).
 */

import { generateMap } from './map.js?v=24';
import { defaultCivs } from './civs.js?v=24';
import { createWorld } from './sim.js?v=24';
import { createRenderer } from './render.js?v=24';
import { POWERS, POWER_BY_ID } from './powers.js?v=24';
import { avatarDataURL } from './avatar.js?v=24';

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
  buildCharts();
  renderStats();
  renderDeputies();
  renderLog();
  renderCharts();
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
function formatDate(ticks) {
  const t = gameTime(ticks);
  return `Año ${t.year}, Mes ${t.month}, Día ${t.day}`;
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
  // Totales arriba: Población e Indecisos.
  const totalPop = world.stats.reduce((a, s) => a + s.pop, 0);
  const tot = document.createElement('span');
  tot.className = 'pchip ptot';
  tot.innerHTML = `👥 <b>${totalPop}</b> afiliados &nbsp; 🧠 <b>${world.freeCount || 0}</b> librepensadores`;
  el.appendChild(tot);
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
}

// ---- Segundos al mando (barra) -------------------------------------------
function renderDeputies() {
  const el = $('deputies');
  if (!el) return;
  el.innerHTML = '';
  world.civs.forEach((c, i) => {
    const d = world.deputy[i];
    const card = document.createElement('div');
    card.className = 'deputy';
    // Deputy history: entries that have ended (have a 'to' date), newest first
    const dlog = world.deputyLog ? world.deputyLog[i] : [];
    const past = dlog.filter((e) => e.to !== null).slice(-3).reverse();
    const histHTML = past.length > 0
      ? `<ul class="dep-hist">${past.map((e) => `<li class="dep-hist-item"><span>${e.name}</span> <span class="dim">${formatStamp(e.from)}</span></li>`).join('')}</ul>`
      : '';
    if (d) {
      const av = avatarDataURL(d.name + d.id, c.color, { size: 34 });
      const yrs = Math.floor((d.age || 0) / 5);
      card.innerHTML = `<div class="dep-main"><img class="dep-av" alt="" src="${av}" />
        <div class="dep-info"><div class="dep-name"></div>
        <div class="dep-sub" style="color:${c.color}">${c.name.replace('Los ', '')} · ⏳ ${yrs} a</div></div></div>${histHTML}`;
      card.querySelector('.dep-name').textContent = d.name;
    } else {
      card.innerHTML = `<div class="dep-main"><div class="dep-info"><div class="dep-name dim">— sin nombrar —</div>
        <div class="dep-sub" style="color:${c.color}">${c.name.replace('Los ', '')}</div></div></div>${histHTML}`;
    }
    el.appendChild(card);
  });
}

// HUD panels refresh on a gentler cadence than the render loop.
setInterval(() => {
  if (world) {
    renderStats();
    renderDeputies();
    // Only rebuild the history list when the reader is at the top; otherwise
    // the periodic rebuild would yank the scroll position back up.
    const lg = $('eventLog');
    if (!lg || lg.scrollTop <= 6) renderLog();
    renderCharts();
    updateTicker();
    updatePartyStrip();
    if (selected) renderInspector();
  }
}, 350);

function updatePlayBtn() {
  $('playBtn').textContent = running ? '⏸ Pausa' : '▶ Jugar';
}

// ---- Dashboard (panel de estadísticas) -----------------------------------
function renderStats() {
  const el = $('stats');
  const land = world.landCount || 1;
  // Preserve any open alcalde-list scroll positions across the rebuild.
  const prevScroll = {};
  el.querySelectorAll('.civ-card').forEach((card) => {
    const ul = card.querySelector('.hr-alc');
    if (ul) prevScroll[card.dataset.civ] = ul.scrollTop;
  });
  el.innerHTML = '';
  const money = (b) => '$' + Math.round(b).toLocaleString('en-US');

  // orden fijo por índice de partido — las tarjetas nunca se mueven
  world.civs.forEach((c, i) => {
    const s = world.stats[i];
    const pct = Math.round((s.territory / land) * 100);
    const budget = world.budget ? world.budget[i] : 0;
    const dead = s.units === 0 && s.cities === 0;
    const lead = world.leaders[i];
    const av = avatarDataURL(c.leader, c.color, { crown: true, size: 44 });
    const slog = world.successionLog ? world.successionLog[i] : [];
    const succNote = slog.length > 0
      ? `<div class="succ-note">⚰️ Nueva toma: ${formatStamp(slog[slog.length - 1].tick)}</div>`
      : '';
    // Jerarquía: Líder → Segundo al mando → un Alcalde por ciudad (con su valor).
    const dep = world.deputy[i];
    const depName = (dep && !dep.dead) ? dep.name : '—';
    const myCities = world.cities.filter((cc) => cc.owner === i);
    const alcaldeRows = myCities.length
      ? myCities.map((cc) =>
          `<li><span class="al-city">🏛️ ${cc.name}</span>` +
          `<span class="al-who">${cc.alcalde || '—'}</span>` +
          `<span class="al-worth">${money(cc.worth || 0)}</span></li>`).join('')
      : '<li class="dim">Sin ciudades todavía</li>';
    const hierarchy = `
      <div class="hierarchy">
        <div class="hr-row"><span class="hr-rank">👑 Líder</span><span class="hr-name">${lead ? lead.rulerName : '—'}</span></div>
        <div class="hr-row"><span class="hr-rank">🎖️ Segundo al mando</span><span class="hr-name">${depName}</span></div>
        <div class="hr-alc-h">🏛️ Alcaldes · ${myCities.length}</div>
        <ul class="hr-alc">${alcaldeRows}</ul>
      </div>`;
    const card = document.createElement('div');
    card.className = 'civ-card';
    card.style.borderLeftColor = c.color;
    card.innerHTML = `
      <div class="civ-head">
        <img class="civ-av" alt="" src="${av}" />
        <div class="civ-id">
          <h3 style="color:${c.color}">${c.name}</h3>
          <div class="ruler">👑 <span></span></div>
        </div>
      </div>
      ${succNote}
      <div class="card-status">${world.leaderStatus(i)}</div>
      <div class="row"><span>Población</span><span>${s.pop}</span></div>
      <div class="row"><span>Ciudades</span><span>${s.cities}</span></div>
      <div class="row"><span>Territorio</span><span>${pct}%</span></div>
      <div class="bar"><div style="width:${pct}%;background:${c.color}"></div></div>
      <div class="row"><span>Presupuesto 💰</span><span class="${budget < 0 ? 'neg' : ''}">${money(budget)}</span></div>
      <div class="row dim"><span>(suma del valor de sus ciudades)</span><span></span></div>
      <div class="row"><span>Afiliados 🧠</span><span>${world.recruited ? world.recruited[i] : 0}</span></div>
      ${hierarchy}
      <div class="tags">
        ${dead ? '<span class="tag dead">sin presencia</span>' : ''}
      </div>
      <div class="card-btns">
        <button class="card-btn" data-act="go" data-civ="${i}">📍 Ir al líder</button>
      </div>
    `;
    card.dataset.civ = i;
    card.querySelector('.ruler span').textContent = lead ? lead.rulerName : '—';
    const ul = card.querySelector('.hr-alc');
    if (ul && prevScroll[i] != null) ul.scrollTop = prevScroll[i];
    el.appendChild(card);
  });
}

// Delegated click for the leader-card button (Ir al líder).
$('stats').addEventListener('click', (e) => {
  const b = e.target.closest('.card-btn');
  if (!b) return;
  const i = Number(b.dataset.civ);
  const lead = world.leaders[i];
  if (!lead) return;
  if (b.dataset.act === 'go') renderer.focusOn(lead.x, lead.y, 3.2);
});

// ---- Gráficas: 15 cuadros en vivo ----------------------------------------
// Cada def: { title, kind, get }. kind: 'lines' (series por partido en el
// tiempo), 'lineOne' (una serie), 'bars' (un valor por partido), 'donut'
// (reparto por partido), 'hist' (histograma de un campo por unidad).
const CHART_DEFS = [
  { id: 'c1', title: 'Afiliados por partido (tiempo)', kind: 'lines', get: () => world.history.map((h) => h.pop) },
  { id: 'c2', title: 'Ciudades por partido (tiempo)', kind: 'lines', get: () => world.history.map((h) => h.terr) },
  { id: 'c3', title: 'Presupuesto en el tiempo ($)', kind: 'lines', get: () => world.history.map((h) => h.budget) },
  { id: 'c4', title: 'Librepensadores en el tiempo', kind: 'lineOne', get: () => world.history.map((h) => h.free) },
  { id: 'c5', title: 'Afiliados actuales', kind: 'bars', get: () => world.stats.map((s) => s.pop) },
  { id: 'c6', title: 'Ciudades (%)', kind: 'bars', get: () => world.stats.map((s) => Math.round((s.territory / (world.landCount || 1)) * 100)) },
  { id: 'c7', title: 'Ciudades', kind: 'bars', get: () => world.stats.map((s) => s.cities) },
  { id: 'c8', title: 'Afiliados (ciudadanos)', kind: 'bars', get: () => world.stats.map((s) => s.units) },
  { id: 'c9', title: 'Afiliaciones (acum.)', kind: 'bars', get: () => world.recruited.slice() },
  { id: 'c10', title: 'Libres vs afiliados', kind: 'donut', get: () => [world.freeCount || 0, world.stats.reduce((a, s) => a + s.pop, 0)] },
  { id: 'c11', title: 'Presupuesto actual ($)', kind: 'bars', get: () => world.budget.map((b) => Math.round(b)) },
  { id: 'c12', title: 'Reparto de ciudades', kind: 'donut', get: () => world.stats.map((s) => s.cities) },
  { id: 'c13', title: 'Mandato del líder (años)', kind: 'bars', get: () => world.leaders.map((l) => (l ? Math.floor((world.tick - l.since) / 5) : 0)) },
  { id: 'c14', title: 'Edades de la población', kind: 'hist', get: () => citizenBuckets((c) => c.age) },
  { id: 'c15', title: 'Antigüedad afiliada', kind: 'hist', get: () => citizenBuckets((c) => (c.party >= 0 && c.joined != null) ? (world.tick - c.joined) : 0) },
];

function citizenBuckets(fn, B = 10) {
  const buckets = new Array(B).fill(0);
  let max = 1;
  for (const c of world.citizens) { const v = fn(c); if (v > max) max = v; }
  for (const c of world.citizens) buckets[Math.min(B - 1, Math.floor((fn(c) / (max + 1)) * B))]++;
  return { buckets, max };
}

function buildCharts() {
  const legend = $('chartLegend');
  legend.innerHTML = '';
  world.civs.forEach((c) => {
    const lg = document.createElement('span');
    lg.className = 'lg';
    lg.innerHTML = `<span class="lgd" style="background:${c.color}"></span>${c.name.replace('Los ', '')}`;
    legend.appendChild(lg);
  });
  const grid = $('chartsGrid');
  grid.innerHTML = '';
  CHART_DEFS.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<h4>${d.title}</h4><canvas id="${d.id}" width="240" height="132"></canvas>`;
    grid.appendChild(card);
  });
}

function renderCharts() {
  const colors = world.civs.map((c) => c.color);
  for (const d of CHART_DEFS) {
    const cv = document.getElementById(d.id);
    if (!cv) continue;
    const x = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    const data = d.get();
    const cols = d.id === 'c10' ? ['#9aa6b2', '#f4b942'] : colors;
    if (d.kind === 'lines') drawLines(x, W, H, data, colors);
    else if (d.kind === 'lineOne') drawLines(x, W, H, data.map((v) => [v]), ['#f4b942']);
    else if (d.kind === 'bars') drawBars(x, W, H, data, cols);
    else if (d.kind === 'donut') drawDonut(x, W, H, data, cols);
    else if (d.kind === 'hist') drawHist(x, W, H, data.buckets, '#f4b942', Math.floor(data.max / 5));
  }
}

function drawLines(x, W, H, samples, colors) {
  if (!samples || samples.length < 2) { noData(x, W, H); return; }
  const n = samples[0].length;
  let max = 1, min = 0;
  for (const row of samples) for (const v of row) { if (v > max) max = v; if (v < min) min = v; }
  const span = max - min || 1;
  for (let s = 0; s < n; s++) {
    x.strokeStyle = colors[s] || '#888';
    x.lineWidth = 1.5;
    x.beginPath();
    samples.forEach((row, k) => {
      const px = (k / (samples.length - 1)) * (W - 4) + 2;
      const py = H - 3 - ((row[s] - min) / span) * (H - 6);
      if (k) x.lineTo(px, py); else x.moveTo(px, py);
    });
    x.stroke();
  }
  scaleLabel(x, W, 'máx ' + (max >= 1000 ? (max / 1000).toFixed(1) + 'k' : max));
}

function scaleLabel(x, W, text) {
  x.fillStyle = '#8fa0b0';
  x.font = '8px system-ui, sans-serif';
  x.textAlign = 'left';
  x.fillText(text, 3, 9);
}

function drawBars(x, W, H, values, colors) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const bw = W / values.length;
  const zeroY = H - 12;
  for (let i = 0; i < values.length; i++) {
    const bh = (Math.abs(values[i]) / max) * (zeroY - 14);
    x.fillStyle = colors[i] || '#888';
    x.fillRect(i * bw + 2, zeroY - bh, bw - 4, bh);
    x.fillStyle = '#cdd6df';
    x.font = '8px system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillText(String(values[i]), i * bw + bw / 2, H - 3);
  }
  scaleLabel(x, W, 'máx ' + max);
}

// Histograma con números: cuenta máxima (eje Y) y rango de edad (eje X).
function drawHist(x, W, H, buckets, color, maxYears) {
  const max = Math.max(1, ...buckets);
  const bw = W / buckets.length;
  for (let i = 0; i < buckets.length; i++) {
    const bh = (buckets[i] / max) * (H - 22);
    x.fillStyle = color;
    x.fillRect(i * bw + 1, H - 12 - bh, bw - 2, bh);
  }
  scaleLabel(x, W, 'máx ' + max);
  x.fillStyle = '#8fa0b0';
  x.font = '8px system-ui, sans-serif';
  x.textAlign = 'left'; x.fillText('0a', 2, H - 2);
  x.textAlign = 'right'; x.fillText((maxYears || 0) + 'a', W - 2, H - 2);
}

function drawDonut(x, W, H, values, colors) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 4;
  let a0 = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const a1 = a0 + (values[i] / total) * Math.PI * 2;
    x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, r, a0, a1); x.closePath();
    x.fillStyle = colors[i] || '#888'; x.fill();
    a0 = a1;
  }
  x.fillStyle = '#0c141d'; x.beginPath(); x.arc(cx, cy, r * 0.55, 0, 7); x.fill();
}

function noData(x, W, H) {
  x.fillStyle = '#5b6b7a';
  x.font = '11px system-ui, sans-serif';
  x.textAlign = 'left';
  x.fillText('Recopilando…', 6, H / 2);
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
    const free = u.party < 0;
    const c = free ? null : world.civs[u.party];
    const accent = free ? '#9aa6b2' : c.color;
    const name = u.isLeader ? u.rulerName : u.name;
    const av = avatarDataURL(u.isLeader ? (c ? c.leader : name) : (u.name + u.id), accent, { crown: u.isLeader, size: 52 });
    const affil = free
      ? (u.committedFree ? 'Librepensador/a comprometido/a' : 'Librepensador/a (indeciso/a)')
      : ((u.isLeader ? (c.title || 'Líder') : (u.isDeputy ? 'Segundo al mando' : 'Afiliado/a')) + ' · ' + c.name);
    const status = u.isLeader ? `<div class="istatus">${world.leaderStatus(u.party)}</div>` : '';
    const joinedRow = (!free && u.joined != null)
      ? `<div class="irow"><span>Afiliado/a desde</span><span>${formatDate(u.joined)}</span></div>` : '';
    const reign = u.isLeader
      ? `<div class="irow"><span>Mandato</span><span>${years(world.tick - u.since)} años</span></div>` : '';
    const mob = u.mobility < 0.25 ? 'Sedentario/a' : u.mobility > 0.7 ? 'Trotamundos' : 'Moderada';
    body.innerHTML = `
      <div class="ihead">
        <img class="iface-img" alt="" src="${av}" />
        <div>
          <div class="iname" style="color:${accent}"></div>
          <div class="ipart">${affil}</div>
        </div>
      </div>
      ${status}
      <div class="irow"><span>Edad</span><span>${years(u.age)} años</span></div>
      <div class="irow"><span>Movilidad</span><span>${mob}</span></div>
      ${joinedRow}
      ${reign}
    `;
    body.querySelector('.iname').textContent = name;
  } else {
    const c = selected.ref;
    const owned = c.owner >= 0;
    const civ = owned ? world.civs[c.owner] : null;
    const accent = owned ? civ.color : '#9aa6b2';
    const alc = c.alcalde || '—';
    body.innerHTML = `
      <div class="ihead">
        <span class="iface" style="background:${accent}">🏛️</span>
        <div>
          <div class="iname" style="color:${accent}"></div>
          <div class="ipart">${owned ? civ.name : 'Neutral (sin partido)'}</div>
        </div>
      </div>
      <div class="irow"><span>Municipio</span><span>${c.muni || '—'}</span></div>
      <div class="irow"><span>Habitantes</span><span>${Math.round(c.pop)}</span></div>
      <div class="irow"><span>Valor 💰</span><span>$${Math.round(c.worth || 0).toLocaleString('en-US')}</span></div>
      <div class="irow"><span>Alcalde/sa</span><span>${alc}</span></div>
    `;
    body.querySelector('.iname').textContent = c.name;
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
