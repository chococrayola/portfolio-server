// Monopolio Boricua — board DOM. Builds the 11×11 grid, moves tokens, deed cards.

import { SPACES, GROUPS, RAIL_RENTS } from './data.js';
import { unmortgageCost, groupOwnedBy } from './engine.js';

export const PLAYER_COLORS = ['#ff2d78', '#22e4f2', '#a3ff47', '#ffb52e'];

// Minimal line-art icons (stroke = currentColor) — no emoji.
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
  go: svg('<path d="M4 12h12M11 6l6 6-6 6"/><path d="M20 5v14"/>'),
  jail: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
  parking: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>'),
  gotojail: svg('<rect x="9" y="4" width="11" height="16" rx="2"/><path d="M13.5 4v16M16.5 4v16M2 12h5M5 9l3 3-3 3"/>'),
  chance: svg('<path d="M9 9a3 3 0 1 1 4.6 2.5c-1 .7-1.6 1.2-1.6 2.5"/><circle cx="12" cy="17.5" r=".8" fill="currentColor"/>'),
  chest: svg('<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M4 12h16M12 8v4M8 8V6a4 4 0 0 1 8 0v2"/>'),
  tax: svg('<path d="M12 4v16M8 7.5c0-1.4 1.8-2.5 4-2.5s4 1.1 4 2.5-1.8 2.5-4 2.5-4 1.1-4 2.5 1.8 2.5 4 2.5 4-1.1 4-2.5"/>'),
  rail: svg('<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/><path d="M8 20l2-4M16 20l-2-4"/>'),
  bolt: svg('<path d="M13 2 5 14h6l-1 8 8-12h-6l1-8z"/>'),
  drop: svg('<path d="M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11z"/>'),
};

function iconFor(s) {
  if (s.type === 'util') return s.i === 12 ? ICONS.bolt : ICONS.drop;
  return ICONS[s.type] ?? '';
}

export function spaceGridPos(i) {
  if (i <= 10) return { row: 11, col: 11 - i };        // bottom, right → left
  if (i <= 20) return { row: 21 - i, col: 1 };         // left, bottom → top
  if (i <= 30) return { row: 1, col: i - 19 };         // top, left → right
  return { row: i - 29, col: 11 };                     // right, top → bottom
}

function sideOf(i) {
  if (i % 10 === 0) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

export function buildBoard(container, onSpaceClick) {
  container.innerHTML = '';
  for (const s of SPACES) {
    const { row, col } = spaceGridPos(s.i);
    const el = document.createElement('div');
    el.className = `space side-${sideOf(s.i)} type-${s.type}`;
    el.dataset.idx = s.i;
    el.style.gridRow = row;
    el.style.gridColumn = col;
    const icon = iconFor(s);
    el.innerHTML = `
      <div class="space-inner">
        ${s.group ? `<div class="color-bar" style="--gc:${GROUPS[s.group].color}"></div>` : ''}
        <div class="space-body">
          ${icon ? `<div class="space-icon">${icon}</div>` : ''}
          <div class="space-name">${s.name}</div>
          ${s.price ? `<div class="space-price">$${s.price}</div>` : ''}
          ${s.type === 'tax' ? `<div class="space-price">$${s.amount}</div>` : ''}
        </div>
        <div class="badges"></div>
        <div class="tokens"></div>
      </div>`;
    el.addEventListener('click', () => onSpaceClick?.(s.i));
    container.appendChild(el);
  }
  const center = document.createElement('div');
  center.id = 'board-center';
  center.innerHTML = `
    <div id="center-logo"><span class="l1">MONOPOLIO</span><span class="l2">BORICUA</span></div>
    <div id="center-banner"></div>
    <div id="dice-area"><span class="die" id="die1"></span><span class="die" id="die2"></span></div>
    <div id="center-card" hidden></div>`;
  container.appendChild(center);
}

// Re-paint ownership, buildings, mortgages, tokens from state.
export function renderBoard(container, state) {
  for (const s of SPACES) {
    const el = container.querySelector(`[data-idx="${s.i}"]`);
    const o = state.owned[s.i];
    const badges = el.querySelector('.badges');
    el.classList.toggle('mortgaged', !!o?.mortgaged);
    let html = '';
    if (o) {
      html += `<span class="owner-chip" style="background:${PLAYER_COLORS[o.owner]}"></span>`;
      if (o.level === 5) html += `<span class="pip hotel"></span>`;
      else if (o.level > 0) html += `<span class="pips">${'<span class="pip"></span>'.repeat(o.level)}</span>`;
      if (o.mortgaged) html += `<span class="mort-tag">HIP</span>`;
    }
    badges.innerHTML = html;
  }
  renderTokens(container, state);
}

export function renderTokens(container, state) {
  for (const p of state.players) {
    let tok = container.querySelector(`.token[data-pid="${p.id}"]`);
    if (p.bankrupt) { tok?.remove(); continue; }
    if (!tok) {
      tok = document.createElement('span');
      tok.className = 'token';
      tok.dataset.pid = p.id;
      tok.textContent = p.token;
      tok.style.setProperty('--pc', PLAYER_COLORS[p.id]);
    }
    const dest = container.querySelector(`[data-idx="${p.pos}"] .tokens`);
    if (tok.parentElement !== dest) {
      dest.appendChild(tok);
      tok.classList.remove('pop');
      void tok.offsetWidth; // restart animation
      tok.classList.add('pop');
    }
  }
}

// Walk a token space-by-space (visual only; state.pos is already final).
export async function animateWalk(container, pid, from, to, stepMs) {
  if (stepMs <= 0) return;
  const tok = container.querySelector(`.token[data-pid="${pid}"]`);
  if (!tok) return;
  let pos = from;
  while (pos !== to) {
    pos = (pos + 1) % 40;
    container.querySelector(`[data-idx="${pos}"] .tokens`)?.appendChild(tok);
    await new Promise(r => setTimeout(r, stepMs));
  }
}

export function deedHTML(state, idx) {
  const s = SPACES[idx];
  const o = state.owned[idx];
  const owner = o ? state.players[o.owner] : null;
  let rows = '';
  if (s.type === 'prop') {
    const labels = ['Solar pelao', '1 casa', '2 casas', '3 casas', '4 casas', 'Hotel'];
    rows = s.rents.map((r, n) => {
      const now = o && (o.level === n || (n === 0 && o.level === 0));
      return `<tr class="${now ? 'now' : ''}"><td>${labels[n]}</td><td>$${n === 0 && o && groupOwnedBy(state, s.group, o.owner) && o.level === 0 ? r * 2 + ' <small>(set completo ×2)</small>' : r}</td></tr>`;
    }).join('');
    rows += `<tr><td>Costo por casa</td><td>$${s.houseCost}</td></tr>`;
  } else if (s.type === 'rail') {
    rows = RAIL_RENTS.map((r, n) => `<tr><td>Con ${n + 1} transporte${n ? 's' : ''}</td><td>$${r}</td></tr>`).join('');
  } else if (s.type === 'util') {
    rows = `<tr><td>Con 1 utility</td><td>4 × dados</td></tr><tr><td>Con las 2</td><td>10 × dados</td></tr>`;
  }
  const bar = s.group ? `style="--gc:${GROUPS[s.group].color}"` : '';
  return `
    <div class="deed">
      <div class="deed-head" ${bar}>${s.name}</div>
      <div class="deed-body">
        ${s.blurb ? `<p class="deed-blurb">${s.blurb}</p>` : ''}
        ${rows ? `<table>${rows}</table>` : ''}
        ${s.price ? `<div class="deed-foot">Precio $${s.price} · Hipoteca $${s.price / 2}${o?.mortgaged ? ` · <b>hipotecada</b> (levantar: $${unmortgageCost(idx)})` : ''}</div>` : ''}
        ${owner ? `<div class="deed-owner">Dueño: <b style="color:${PLAYER_COLORS[owner.id]}">${owner.token} ${owner.name}</b></div>` : (s.price ? '<div class="deed-owner">Sin dueño (por ahora…)</div>' : '')}
      </div>
    </div>`;
}
