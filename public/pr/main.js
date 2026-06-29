/* main.js — wires the DOM to the simulation.
 *
 * Owns the game loop (play/pause + speed), the god-power toolbox, the live
 * stats/event panels, the inspector, and the trait editor (persisted to
 * localStorage and applied on Reset).
 */

import { generateMap } from './map.js?v=38';
import { defaultCivs } from './civs.js?v=38';
import { createWorld } from './sim.js?v=38';
import { createRenderer } from './render.js?v=38';
import { POWERS, POWER_BY_ID } from './powers.js?v=38';
import { avatarDataURL } from './avatar.js?v=38';

const STORAGE = { traits: 'pr.traits', speed: 'pr.speed', seed: 'pr.seed' };
const PAINTABLE = new Set(['spawn', 'free']);

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
  renderAlcaldes();
  renderLog();
  renderCharts();
  updateClock();
  updateTicker();
  updatePartyStrip();
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
  if (running) {
    tickAcc += dt * tps();
    let budget = Math.min(tickAcc | 0, 120); // cap catch-up per frame
    tickAcc -= budget;
    while (budget-- > 0) world.step();
  }
  renderer.draw();
  $('tickVal').textContent = world.tick;
  updateClock();
  requestAnimationFrame(loop);
}

// ---- Game calendar (1 tick = 1 DAY; 30-day months, 360-day years) -------
// Un día por turno: la edad (en años) avanza con el calendario, que arranca el
// 1/1/1948 y corre lento. Formato de fecha: D/M/AAAA.
const BASE_YEAR = 1948;      // el calendario arranca el 1/1/1948
const YEAR_DAYS = 360, MONTH_DAYS = 30;
function gameTime(ticks) {
  const day = (ticks % MONTH_DAYS) + 1;
  const month = (Math.floor(ticks / MONTH_DAYS) % 12) + 1;
  const year = Math.floor(ticks / YEAR_DAYS) + BASE_YEAR;
  return { day, month, year };
}
function formatClock(ticks) {
  const t = gameTime(ticks);
  return `📅 ${t.day}/${t.month}/${t.year}`;
}
function formatStamp(ticks) {
  const t = gameTime(ticks);
  return `${t.day}/${t.month}/${t.year}`;
}
function formatDate(ticks) {
  const t = gameTime(ticks);
  return `${t.day}/${t.month}/${t.year}`;
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

// HUD panels refresh on a gentler cadence than the render loop.
let lastHudTick = -1;
setInterval(() => {
  if (!world) return;
  // Idle guard: while paused with no new tick, nothing in the HUD changed, so
  // skip the heavy rebuilds (cards/charts/inspector) — saves CPU + battery.
  if (!running && world.tick === lastHudTick) return;
  lastHudTick = world.tick;
  renderStats();
  renderAlcaldes();
  // Only rebuild the history list when the reader is at the top; otherwise
  // the periodic rebuild would yank the scroll position back up.
  const lg = $('eventLog');
  if (!lg || lg.scrollTop <= 6) renderLog();
  renderCharts();
  updateTicker();
  updatePartyStrip();
  if (selected) renderInspector();
}, 350);

function updatePlayBtn() {
  $('playBtn').textContent = running ? '⏸ Pausa' : '▶ Jugar';
}

// ---- Política del líder (cerebro de reglas) ------------------------------
const POLICY_KEYS = [['expansion', 'Ex'], ['economy', 'Ec'], ['welfare', 'Bi'], ['campaign', 'Ca'], ['austerity', 'Au']];
function policyHTML(i) {
  const pol = world.policy ? world.policy[i] : null;
  if (!pol) return '';
  const stance = world.stance ? world.stance[i] : '—';
  const bars = POLICY_KEYS.map(([k, lbl]) =>
    `<span class="pbar" title="${k}: ${Math.round((pol[k] || 0) * 100)}%"><span class="pbar-fill" style="height:${Math.round((pol[k] || 0) * 100)}%"></span><em>${lbl}</em></span>`).join('');
  return `<div class="policy"><span class="pstance">🧭 ${stance}</span><span class="pbars">${bars}</span></div>`;
}

// Mini sparkline para la trayectoria de un pueblo (población/valor en el tiempo).
function drawSpark(id, hist, key, color, label) {
  const cv = document.getElementById(id);
  if (!cv) return;
  const x = cv.getContext('2d'); const W = cv.width, H = cv.height;
  x.clearRect(0, 0, W, H);
  if (!hist || hist.length < 2) { x.fillStyle = '#5b6b7a'; x.font = '9px system-ui, sans-serif'; x.fillText('Recopilando…', 4, H / 2); return; }
  let mn = Infinity, mx = -Infinity;
  for (const s of hist) { const v = s[key]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = (mx - mn) || 1;
  x.strokeStyle = color; x.lineWidth = 1.5; x.beginPath();
  hist.forEach((s, k) => {
    const px = (k / (hist.length - 1)) * (W - 4) + 2;
    const py = H - 3 - ((s[key] - mn) / span) * (H - 12);
    if (k) x.lineTo(px, py); else x.moveTo(px, py);
  });
  x.stroke();
  x.fillStyle = '#8fa0b0'; x.font = '8px system-ui, sans-serif'; x.textAlign = 'left';
  x.fillText(`${label} · máx ${mx >= 1000 ? (mx / 1000).toFixed(1) + 'k' : Math.round(mx)}`, 3, 9);
}

// Avatares de líder son constantes por partido (nombre + color fijos): se
// generan una sola vez y se reutilizan en cada rebuild de las tarjetas.
const avatarCache = new Map();
function cachedAvatar(key, name, color, opts) {
  let u = avatarCache.get(key);
  if (u === undefined) { u = avatarDataURL(name, color, opts); avatarCache.set(key, u); }
  return u;
}

// ---- Dashboard (panel de estadísticas) -----------------------------------
function renderStats() {
  const el = $('stats');
  const land = world.landCount || 1;
  el.innerHTML = '';
  const money = (b) => '$' + Math.round(b).toLocaleString('en-US');

  // orden fijo por índice de partido — las tarjetas nunca se mueven
  world.civs.forEach((c, i) => {
    const s = world.stats[i];
    const pct = Math.round((s.territory / land) * 100);
    const budget = world.budget ? world.budget[i] : 0;
    const dead = s.units === 0 && s.cities === 0;
    const lead = world.leaders[i];
    const av = cachedAvatar('lead' + i, c.leader, c.color, { crown: true, size: 44 });
    const slog = world.successionLog ? world.successionLog[i] : [];
    const succNote = slog.length > 0
      ? `<div class="succ-note">⚰️ Nueva toma: ${formatStamp(slog[slog.length - 1].tick)}</div>`
      : '';
    // Jerarquía: Líder → Segundo al mando → un Alcalde por ciudad (con su valor).
    const dep = world.deputy[i];
    const depName = (dep && !dep.dead) ? dep.name : '—';
    // Mostrar los pueblos más valiosos (lista compacta y de altura fija para que
    // la tarjeta no crezca sin control al ganar ciudades).
    const myCities = world.cities.filter((cc) => cc.owner === i)
      .sort((a, b) => (b.worth || 0) - (a.worth || 0));
    const TOP_ALC = 6;
    const shownCities = myCities.slice(0, TOP_ALC);
    const extraCities = myCities.length - shownCities.length;
    const alcaldeRows = myCities.length
      ? shownCities.map((cc) =>
          `<li><span class="al-city">🏛️ ${cc.name}</span>` +
          `<span class="al-who">${cc.alcalde || '—'}</span>` +
          `<span class="al-worth">${money(cc.worth || 0)}</span></li>`).join('') +
        (extraCities > 0 ? `<li class="al-more">+${extraCities} pueblo${extraCities > 1 ? 's' : ''} más</li>` : '')
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
      ${policyHTML(i)}
      <div class="row"><span>Población</span><span>${s.pop}</span></div>
      <div class="row"><span>Ciudades</span><span>${s.cities}</span></div>
      <div class="row"><span>Territorio</span><span>${pct}%</span></div>
      <div class="bar"><div style="width:${pct}%;background:${c.color}"></div></div>
      <div class="row"><span>Presupuesto 💰</span><span class="${budget < 0 ? 'neg' : ''}">${money(budget)}</span></div>
      <div class="row dim"><span>(suma del valor de sus ciudades)</span><span></span></div>
      <div class="row"><span>Balance del líder 💵</span><span>${lead ? money(lead.balance || 0) : '—'}</span></div>
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

// ---- Alcaldes: panel dedicado con TODOS los alcaldes y sus datos ---------
function renderAlcaldes() {
  const el = $('alcaldesPanel');
  if (!el) return;
  const money = (b) => '$' + Math.round(b).toLocaleString('en-US');
  const yrs = (t) => Math.floor(t / 360);
  // Todos los pueblos con dueño y un/a alcalde/sa real, del más valioso al menos.
  const rows = world.cities
    .filter((c) => c.owner >= 0 && c.alcaldeRef && !c.alcaldeRef.dead)
    .sort((a, b) => (b.worth || 0) - (a.worth || 0));
  $('alcaldeCount').textContent = rows.length;
  if (!rows.length) {
    el.innerHTML = '<div class="alc-empty">Aún no hay alcaldes: ningún partido controla un pueblo.</div>';
    return;
  }
  el.innerHTML = rows.map((c) => {
    const civ = world.civs[c.owner];
    const a = c.alcaldeRef;
    const cap = c.capacity || 0;
    const ci = world.cities.indexOf(c);
    return `<div class="alc-row" data-city="${ci}" style="border-left-color:${civ.color}">
      <div class="alc-top">
        <span class="alc-city">🏛️ ${c.name}</span>
        <span class="alc-party" style="color:${civ.color}">${civ.name.replace('Los ', '')}</span>
      </div>
      <div class="alc-name">👤 ${a.name}</div>
      <div class="alc-stats">
        <span title="Edad">🎂 ${yrs(a.age)} a</span>
        <span title="Dinero personal">💵 ${money(a.balance || 0)}</span>
        <span title="Valor del pueblo">💰 ${money(c.worth || 0)}</span>
        <span title="Ciudadanos / capacidad">👥 ${Math.round(c.pop)}/${cap}</span>
        <span title="Años en el cargo">🗓️ ${yrs(world.tick - (c.alcaldeSince || 0))} a</span>
      </div>
    </div>`;
  }).join('');
}

// Tap an alcalde row to open that citizen's full card.
$('alcaldesPanel').addEventListener('click', (e) => {
  const row = e.target.closest('.alc-row');
  if (!row) return;
  const c = world.cities[Number(row.dataset.city)];
  if (c && c.alcaldeRef) { selected = { kind: 'unit', ref: c.alcaldeRef }; renderInspector(); }
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
  { id: 'c13', title: 'Mandato del líder (años)', kind: 'bars', get: () => world.leaders.map((l) => (l ? Math.floor((world.tick - l.since) / 360) : 0)) },
  { id: 'c14', title: 'Edades de la población', kind: 'hist', get: () => citizenBuckets((c) => c.age) },
  { id: 'c15', title: 'Antigüedad afiliada', kind: 'hist', get: () => citizenBuckets((c) => world.tick - c.joined, 10, (c) => c.party >= 0 && c.joined != null) },
];

// Histograma sobre los ciudadanos. `pred` (opcional) filtra quién cuenta — p.ej.
// la antigüedad afiliada sólo considera a los afiliados, no a los indecisos.
function citizenBuckets(fn, B = 10, pred = null) {
  const arr = pred ? world.citizens.filter(pred) : world.citizens;
  const buckets = new Array(B).fill(0);
  let max = 1;
  for (const c of arr) { const v = fn(c); if (v > max) max = v; }
  for (const c of arr) buckets[Math.min(B - 1, Math.floor((fn(c) / (max + 1)) * B))]++;
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
    else if (d.kind === 'hist') drawHist(x, W, H, data.buckets, '#f4b942', Math.floor(data.max / 360));
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
  let lastYear = null;
  for (const e of world.events.slice(0, 120)) {
    // Year separator (events are newest-first); each row tags its month.
    const g = gameTime(e.tick);
    if (g.year !== lastYear) {
      lastYear = g.year;
      const sep = document.createElement('li');
      sep.className = 'ev-day';
      sep.textContent = `Año ${g.year}`;
      el.appendChild(sep);
    }
    const color = e.civ != null ? world.civs[e.civ].color : '#7c8a99';
    const li = document.createElement('li');
    li.className = 'ev';
    const dot = document.createElement('span');
    dot.className = 'ev-dot';
    dot.style.background = color;
    const text = document.createElement('span');
    text.className = 'ev-text';
    text.textContent = e.text; // textContent avoids HTML injection from names
    const time = document.createElement('span');
    time.className = 'ev-time';
    time.textContent = `${g.day}/${g.month}`;
    li.appendChild(dot);
    li.appendChild(text);
    li.appendChild(time);
    el.appendChild(li);
  }
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
  if (tool === 'hurricane') {
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

function inspectAt(clientX, clientY) {
  const { x, y } = renderer.screenToTile(clientX, clientY);
  // Prefer a city when the tap lands right on its center (cities sit under a
  // cluster of citizens, so without this you could never inspect the city).
  const c = world.cityAtTile(x, y);
  if (c && Math.hypot(c.x - x, c.y - y) <= 1.6) { selected = { kind: 'city', ref: c }; renderInspector(); return; }
  const u = world.unitAt(x, y);
  if (u) { selected = { kind: 'unit', ref: u }; renderInspector(); return; }
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
  const years = (ticks) => Math.floor(ticks / 360);

  if (selected.kind === 'unit') {
    const u = selected.ref;
    const free = u.party < 0;
    const c = free ? null : world.civs[u.party];
    const accent = free ? '#9aa6b2' : c.color;
    const name = u.isLeader ? u.rulerName : u.name;
    const av = avatarDataURL(u.isLeader ? (c ? c.leader : name) : (u.name + u.id), accent, { crown: u.isLeader, size: 52 });
    const role = u.isLeader ? (c.title || 'Líder')
      : u.isDeputy ? 'Segundo al mando'
      : u.isAlcalde ? `Alcalde/sa${u.alcaldeOf ? ' de ' + u.alcaldeOf : ''}`
      : 'Afiliado/a';
    const affil = free
      ? (u.committedFree ? 'Librepensador/a comprometido/a' : 'Librepensador/a (indeciso/a)')
      : (role + ' · ' + c.name);
    const status = u.dead
      ? '<div class="istatus">⚰️ Ha fallecido</div>'
      : (u.isLeader ? `<div class="istatus">${world.leaderStatus(u.party)}</div>` : '');
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
      ${u.profession ? `<div class="irow"><span>Profesión</span><span>${u.profession}</span></div>` : ''}
      <div class="irow"><span>Edad</span><span>${years(u.age)} años</span></div>
      <div class="irow"><span>Balance 💵</span><span>$${Math.round(u.balance || 0).toLocaleString('en-US')}</span></div>
      <div class="irow"><span>Movilidad</span><span>${mob}</span></div>
      ${joinedRow}
      ${reign}
      ${(u.log && u.log.length) ? `<div class="ilog"><div class="ilog-h">Trayectoria</div><ul>${u.log.slice().reverse().map((e) => `<li><span class="t">${formatStamp(e.t)}</span> ${e.ev}</li>`).join('')}</ul></div>` : ''}
    `;
    body.querySelector('.iname').textContent = name;
  } else {
    const c = selected.ref;
    const owned = c.owner >= 0;
    const civ = owned ? world.civs[c.owner] : null;
    const accent = owned ? civ.color : '#9aa6b2';
    const alcRef = (c.alcaldeRef && !c.alcaldeRef.dead) ? c.alcaldeRef : null;
    const alc = alcRef
      ? `<button class="al-link" data-alc="1">${alcRef.name} 👤</button>`
      : (c.alcalde || '—');
    const cap = c.capacity || 0;
    const pct = cap ? Math.round((c.pop / cap) * 100) : 0;
    body.innerHTML = `
      <div class="ihead">
        <span class="iface" style="background:${accent}">🏛️</span>
        <div>
          <div class="iname" style="color:${accent}"></div>
          <div class="ipart">${owned ? civ.name : 'Neutral (sin partido)'}</div>
        </div>
      </div>
      <div class="irow"><span>Municipio</span><span>${c.muni || '—'}</span></div>
      <div class="irow"><span>Ciudadanos</span><span>${Math.round(c.pop)} / ${cap} (${pct}%)</span></div>
      <div class="ibar"><div style="width:${Math.min(100, pct)}%;background:${accent}"></div></div>
      <div class="irow"><span>Valor 💰</span><span>$${Math.round(c.worth || 0).toLocaleString('en-US')}</span></div>
      <div class="irow dim"><span>Población real (2020)</span><span>${(c.realPop || 0).toLocaleString('en-US')}</span></div>
      <div class="irow"><span>Alcalde/sa</span><span>${alc}</span></div>
      <div class="idev"><div class="idev-h">Desarrollo del pueblo</div>
        <canvas id="ispPop" width="212" height="46"></canvas>
        <canvas id="ispWorth" width="212" height="46"></canvas>
      </div>
    `;
    body.querySelector('.iname').textContent = c.name;
    const ci = world.cities.indexOf(c);
    const hist = (world.cityHistory && ci >= 0) ? world.cityHistory[ci] : [];
    drawSpark('ispPop', hist, 'pop', accent, 'Población');
    drawSpark('ispWorth', hist, 'worth', '#f4b942', 'Valor');
  }
  el.classList.remove('hidden');
}

$('inspClose').addEventListener('click', () => { selected = null; $('inspector').classList.add('hidden'); });

// Tapping a city's alcalde/sa opens that real citizen's card.
$('inspBody').addEventListener('click', (e) => {
  if (!e.target.closest('.al-link')) return;
  if (selected && selected.kind === 'city' && selected.ref.alcaldeRef) {
    selected = { kind: 'unit', ref: selected.ref.alcaldeRef };
    renderInspector();
  }
});

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
  running = !running;
  updatePlayBtn();
});
$('stepBtn').addEventListener('click', () => {
  world.step();
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
  $('speedVal').textContent = speed + '× · ' + tps() + ' días/s';
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
$('speedVal').textContent = speed + '× · ' + tps() + ' días/s';
buildWorld();
buildToolUI();
updatePlayBtn();
requestAnimationFrame(loop);
