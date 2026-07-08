// Monopolio Boricua — orchestrator: setup, game loop, io bridge, log, save/resume.

import { SPACES, TOKENS, PERSONALITIES, FLAVOR, pick } from './data.js';
import { newGame, runTurn, netWorth, legalActions } from './engine.js';
import { decide as aiDecide } from './ai.js';
import { buildBoard, renderBoard, animateWalk, PLAYER_COLORS } from './board.js';
import * as modals from './modals.js';

const qs = new URLSearchParams(location.search);
const AUTOTEST = qs.get('autotest') === '1';
const SAVE_KEY = 'monopolio-pr:save';
const PREFS_KEY = 'monopolio-pr:prefs';

const SPEEDS = {
  normal: { ai: 500, step: 80, dice: 420, card: 2200, bid: 350 },
  fast: { ai: 140, step: 22, dice: 140, card: 900, bid: 100 },
  instant: { ai: 0, step: 0, dice: 0, card: 0, bid: 0 },
};
let SPEED = SPEEDS.normal;

let state = null;
let boardEl, logEl, bannerEl;
let auctionView = null;

const delay = (ms) => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
const rnd = () => Math.random();
const personaOf = (p) => p.isAI && p.personality != null ? PERSONALITIES[p.personality % PERSONALITIES.length] : null;

// ---------- Log ----------

function log(text, kind = 'info') {
  const p = document.createElement('p');
  p.className = kind;
  p.textContent = text;
  logEl.prepend(p);
  while (logEl.childElementCount > 250) logEl.lastChild.remove();
}

function flavor(key, vars = {}) {
  let t = pick(rnd, FLAVOR[key] ?? ['']);
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`%${k}%`, v);
  return t;
}

function quip(p, kind, vars = {}, chance = 0.55) {
  const persona = personaOf(p);
  if (!persona || SPEED === SPEEDS.instant || rnd() > chance) return;
  const lines = persona.quips[kind];
  if (!lines?.length) return;
  let t = pick(rnd, lines);
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`%${k}%`, v);
  log(`${p.token} ${p.name}: "${t}"`, 'quip');
}

// ---------- Panel ----------

function updatePanel() {
  const box = document.getElementById('players-box');
  box.innerHTML = state.players.map(p => {
    const props = Object.values(state.owned).filter(o => o.owner === p.id).length;
    return `<div class="player-card ${p.id === state.turn && !state.gameOver ? 'current' : ''} ${p.bankrupt ? 'dead' : ''}"
      style="border-left:5px solid ${PLAYER_COLORS[p.id]}">
      <div class="pc-row">
        <span class="pc-token">${p.token}</span>
        <span class="pc-name">${p.name}${p.isAI ? ' 🤖' : ''}</span>
        <span class="pc-cash">$${p.cash}</span>
      </div>
      <div class="pc-extra">${props} propiedades${p.jailCards.length ? ` · 🎟️×${p.jailCards.length}` : ''}${p.inJail ? ' · <span class="pc-jail">EN LA CÁRCEL 🚔</span>' : ''}</div>
    </div>`;
  }).join('');
}

function setBanner(text) { bannerEl.textContent = text; }

// ---------- Action bar (human pre-roll) ----------

function actionBar(buttons) {
  return new Promise(res => {
    const bar = document.getElementById('action-bar');
    bar.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls ?? '');
      btn.textContent = b.label;
      btn.disabled = !!b.disabled;
      btn.onclick = () => { bar.innerHTML = ''; res(b.value); };
      bar.appendChild(btn);
    }
  });
}

let manageOpen = false;

async function humanPreRoll(pid, payload) {
  for (;;) {
    if (manageOpen) {
      const a = await modals.managePanel(state, pid, {});
      if (a.action === 'close') { manageOpen = false; modals.closeModal(); continue; }
      return a;
    }
    updatePanel();
    const la = payload.actions ?? legalActions(state, pid);
    const pick2 = await actionBar([
      { label: '🎲 Tirar los dados', cls: 'primary', value: 'roll' },
      { label: '🏠 Propiedades', value: 'manage' },
      { label: '🤝 Negociar', value: 'trade', disabled: !la.canTrade },
    ]);
    if (pick2 === 'roll') return { action: 'roll' };
    if (pick2 === 'manage') { manageOpen = true; continue; }
    if (pick2 === 'trade') {
      const trade = await modals.tradeBuilder(state, pid);
      if (trade) return { action: 'trade', trade };
    }
  }
}

async function humanRaiseCash(pid, payload) {
  const creditorName = payload.creditor === 'bank' ? null : state.players[payload.creditor].name;
  return modals.managePanel(state, pid, { debt: { amount: payload.amount, creditorName } });
}

// ---------- io bridge ----------

const io = {
  async decide(pid, type, payload) {
    const p = state.players[pid];
    if (p.isAI) {
      if (type !== 'auctionBid') await delay(SPEED.ai);
      return aiDecide(state, pid, type, payload);
    }
    switch (type) {
      case 'preRoll': return humanPreRoll(pid, payload);
      case 'buyOrAuction': return modals.buyOrAuction(state, pid, payload);
      case 'jail': return modals.jailModal(state, pid, payload);
      case 'auctionBid': {
        auctionView.highBid = payload.highBid;
        auctionView.highBidder = payload.highBidder;
        const answer = await modals.renderAuction(state, auctionView, {
          minBid: payload.minBid, maxBid: payload.maxBid,
        });
        return answer;
      }
      case 'raiseCash': return humanRaiseCash(pid, payload);
      case 'tradeRespond': return modals.tradeRespond(state, pid, payload.trade);
      default: return {};
    }
  },

  async emit(ev) {
    const P = ev.pid != null ? state.players[ev.pid] : null;
    switch (ev.type) {
      case 'turnStart':
        manageOpen = false;
        setBanner(`Le toca a ${P.token} ${P.name}`);
        updatePanel();
        saveGame();
        break;
      case 'dice': {
        const [a, b] = ev.dice;
        for (const [id, v] of [['die1', a], ['die2', b]]) {
          const el = document.getElementById(id);
          el.textContent = v;
          el.classList.add('show');
          el.classList.remove('rolling');
          void el.offsetWidth;
          el.classList.add('rolling');
        }
        if (a === b) log(`${P.token} ${P.name} sacó dobles (${a}-${b}). ${ev.inJail ? '' : '¡Tira otra vez!'}`);
        await delay(SPEED.dice);
        break;
      }
      case 'move': {
        const tok = boardEl.querySelector(`.token[data-pid="${ev.pid}"]`);
        const fromIdx = tok?.closest('.space') ? Number(tok.closest('.space').dataset.idx) : ev.to;
        if (!ev.teleport && SPEED.step > 0) await animateWalk(boardEl, ev.pid, fromIdx, ev.to, SPEED.step);
        renderBoard(boardEl, state);
        break;
      }
      case 'passGo':
        log(flavor('pass_go', { P: P.name }), 'money');
        updatePanel();
        break;
      case 'landed': {
        const s = SPACES[ev.idx];
        if (s.type === 'jail') log(flavor('land_jail_visit', { P: P.name }));
        renderBoard(boardEl, state);
        updatePanel();
        break;
      }
      case 'bought':
        log(flavor('bought', { P: P.name, S: SPACES[ev.idx].name, AMT: ev.price }), 'money');
        quip(P, 'buy');
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'rentDue': {
        const owner = state.players[ev.owner];
        log(flavor('rent_paid', { P: P.name, O: owner.name, AMT: ev.rent }), 'rent');
        quip(owner, 'rent', { AMT: ev.rent });
        break;
      }
      case 'taxDue':
        log(flavor('tax', { P: P.name, AMT: ev.amount }), 'rent');
        break;
      case 'cash':
        updatePanel();
        break;
      case 'card': {
        const deckName = ev.deck;
        if (P.isAI || AUTOTEST) {
          const cardBox = document.getElementById('center-card');
          cardBox.hidden = false;
          cardBox.innerHTML = `<div class="card-deck">${deckName === 'chance' ? '¿QUÉ PASÓ? ❓' : 'EL CORILLO 📦'}</div>${ev.card.text}`;
          log(`${P.token} ${P.name} sacó carta: ${ev.card.text}`, 'info');
          await delay(SPEED.card);
        } else {
          log(`${P.token} ${P.name} sacó carta: ${ev.card.text}`, 'info');
          await modals.cardModal(deckName, ev.card);
        }
        break;
      }
      case 'jail':
        log(flavor('go_to_jail', { P: P.name }), 'jail');
        quip(P, 'jail', {}, 0.8);
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'jailOut': {
        const key = { doubles: 'jail_out_doubles', pay: 'jail_pay', card: 'jail_card', forced: 'jail_pay' }[ev.how];
        log(flavor(key, { P: P.name }), 'jail');
        updatePanel();
        break;
      }
      case 'jailStay':
        log(`${P.token} ${P.name} sigue preso (intento ${ev.attempt}/3). El dominó de la galera está bueno.`, 'jail');
        break;
      case 'auctionStart':
        auctionView = { idx: ev.idx, highBid: 0, highBidder: null, out: new Set() };
        log(`🔨 ¡SUBASTA! ${SPACES[ev.idx].name} al mejor postor.`, 'trade');
        if (!AUTOTEST && SPEED !== SPEEDS.instant) modals.renderAuction(state, auctionView, null);
        break;
      case 'auctionBid':
        auctionView.highBid = ev.bid;
        auctionView.highBidder = ev.pid;
        log(`🔨 ${P.token} ${P.name} puja $${ev.bid} por ${SPACES[ev.idx].name}.`, 'trade');
        quip(P, 'auction', { AMT: ev.bid }, 0.3);
        if (!AUTOTEST && SPEED !== SPEEDS.instant) { modals.renderAuction(state, auctionView, null); await delay(SPEED.bid); }
        break;
      case 'auctionPass':
        auctionView.out.add(ev.pid);
        if (!AUTOTEST && SPEED !== SPEEDS.instant) { modals.renderAuction(state, auctionView, null); await delay(SPEED.bid); }
        break;
      case 'auctionWon':
        log(flavor('auction_won', { P: P.name, S: SPACES[ev.idx].name, AMT: ev.bid }), 'trade');
        modals.closeModal();
        auctionView = null;
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'auctionNobody':
        log(flavor('auction_nobody', { S: SPACES[ev.idx].name }), 'trade');
        modals.closeModal();
        auctionView = null;
        break;
      case 'buildings': {
        const o = state.owned[ev.idx];
        if (o && ev.pid != null) {
          if (o.level === 5) log(flavor('hotel', { P: state.players[ev.pid].name, S: SPACES[ev.idx].name }), 'money');
          else if (ev.level != null) log(flavor('built', { P: state.players[ev.pid].name, S: SPACES[ev.idx].name }), 'money');
        }
        renderBoard(boardEl, state);
        updatePanel();
        break;
      }
      case 'mortgaged':
        log(flavor('mortgage', { P: state.players[ev.pid].name, S: SPACES[ev.idx].name }));
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'unmortgaged':
        log(`${state.players[ev.pid].name} levantó la hipoteca de ${SPACES[ev.idx].name}. El banco llora.`, 'money');
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'trade':
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'tradeRejected': {
        const to = state.players[ev.trade.to];
        log(`${to.token} ${to.name} dijo que NO al trade. "Mejor me quedo como estoy."`, 'trade');
        break;
      }
      case 'bankrupt':
        log(flavor('bankrupt', { P: P.name }), 'boom');
        quip(P, 'broke', {}, 1);
        renderBoard(boardEl, state);
        updatePanel();
        break;
      case 'log':
        log(ev.text, ev.kind ?? 'info');
        break;
      case 'gameover':
        break; // handled after the loop
      case 'turnEnd':
        document.getElementById('center-card').hidden = true;
        updatePanel();
        break;
    }
  },
};

// ---------- Save / resume ----------

function saveGame() {
  if (AUTOTEST || !state || state.gameOver) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.players?.length >= 2 && !s.gameOver ? s : null;
  } catch { return null; }
}

// ---------- Game loop ----------

async function startGame(initialState) {
  state = initialState;
  document.getElementById('setup').hidden = true;
  document.getElementById('game').hidden = false;
  boardEl = document.getElementById('board');
  logEl = document.getElementById('log');
  buildBoard(boardEl, (idx) => { if (!modals.modalOpen()) modals.showDeedPopup(state, idx); });
  bannerEl = document.getElementById('center-banner');
  renderBoard(boardEl, state);
  updatePanel();
  if (AUTOTEST) window.__mono = { state };
  log('🎲 ¡Arrancó el Monopolio Boricua! Que gane el más buitre.', 'boom');

  const turnCap = AUTOTEST ? 3000 : Infinity;
  let turns = 0;
  while (!state.gameOver && turns < turnCap) {
    await runTurn(state, io);
    turns++;
  }
  if (!state.gameOver) { // autotest safety valve only
    const alive = state.players.filter(p => !p.bankrupt);
    state.winner = alive.sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id))[0].id;
    state.gameOver = true;
  }
  clearSave();
  const winner = state.players[state.winner];
  setBanner(`👑 ${winner.token} ${winner.name} ganó`);
  log(flavor('win', { P: winner.name }), 'boom');
  updatePanel();
  if (AUTOTEST) {
    document.title = `GANÓ ${winner.name}`;
    return;
  }
  await modals.gameOver(state, personaOf);
  location.reload();
}

// ---------- Setup screen ----------

function buildSetup() {
  const saved = loadSave();
  if (saved) {
    document.getElementById('resume-box').hidden = false;
    document.getElementById('btn-resume').onclick = () => startGame(saved);
    document.getElementById('btn-fresh').onclick = () => {
      clearSave();
      document.getElementById('resume-box').hidden = true;
    };
  }

  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch { /* ignore */ }

  const rowsEl = document.getElementById('player-rows');
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const def = prefs?.rows?.[i];
    rows.push({
      enabled: def?.enabled ?? i < 3,
      human: def?.human ?? i === 0,
      name: def?.name ?? (i === 0 ? 'Tú' : PERSONALITIES[i % PERSONALITIES.length].name),
      token: def?.token ?? TOKENS[i],
      personality: def?.personality ?? i % PERSONALITIES.length,
    });
  }

  const render = () => {
    rowsEl.innerHTML = rows.map((r, i) => `
      <div class="player-row ${r.enabled ? '' : 'off'}">
        ${i >= 2 ? `<input type="checkbox" data-en="${i}" ${r.enabled ? 'checked' : ''} title="Incluir jugador">` : ''}
        <button class="token-pick" data-tok="${i}" ${r.enabled ? '' : 'disabled'}>${r.token}</button>
        <input type="text" data-name="${i}" value="${r.name.replace(/"/g, '&quot;')}" ${r.enabled ? '' : 'disabled'} maxlength="16">
        <div class="seg">
          <button data-kind="${i}:human" class="${r.human ? 'on' : ''}" ${r.enabled ? '' : 'disabled'}>Humano</button>
          <button data-kind="${i}:bot" class="${r.human ? '' : 'on'}" ${r.enabled ? '' : 'disabled'}>Bot</button>
        </div>
        ${!r.human && r.enabled ? `<span class="bot-tag">🤖 ${PERSONALITIES[r.personality].name} — ${PERSONALITIES[r.personality].style} <button class="btn small" data-reroll="${i}">🎲</button></span>` : ''}
      </div>`).join('');

    rowsEl.querySelectorAll('[data-en]').forEach(el => el.onchange = () => { rows[+el.dataset.en].enabled = el.checked; render(); });
    rowsEl.querySelectorAll('[data-tok]').forEach(el => el.onclick = () => {
      const i = +el.dataset.tok;
      const used = rows.filter((_, j) => j !== i).map(r => r.token);
      let k = (TOKENS.indexOf(rows[i].token) + 1) % TOKENS.length;
      while (used.includes(TOKENS[k])) k = (k + 1) % TOKENS.length;
      rows[i].token = TOKENS[k];
      render();
    });
    rowsEl.querySelectorAll('[data-name]').forEach(el => el.onchange = () => { rows[+el.dataset.name].name = el.value.trim() || `Jugador ${+el.dataset.name + 1}`; });
    rowsEl.querySelectorAll('[data-kind]').forEach(el => el.onclick = () => {
      const [i, kind] = el.dataset.kind.split(':');
      const r = rows[+i];
      const wasHuman = r.human;
      r.human = kind === 'human';
      if (wasHuman && !r.human) r.name = PERSONALITIES[r.personality].name;
      render();
    });
    rowsEl.querySelectorAll('[data-reroll]').forEach(el => el.onclick = () => {
      const r = rows[+el.dataset.reroll];
      r.personality = Math.floor(Math.random() * PERSONALITIES.length);
      r.name = PERSONALITIES[r.personality].name;
      render();
    });
  };
  render();

  document.querySelectorAll('#speed-seg button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#speed-seg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      SPEED = SPEEDS[b.dataset.speed];
    };
  });

  document.getElementById('btn-start').onclick = () => {
    const active = rows.filter(r => r.enabled);
    if (active.length < 2) { alert('Mínimo 2 jugadores. Hasta pa’ pelear hacen falta dos.'); return; }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ rows })); } catch { /* ignore */ }
    clearSave();
    startGame(newGame({
      players: active.map(r => ({
        name: r.name, token: r.token, isAI: !r.human,
        personality: r.human ? null : r.personality,
      })),
    }));
  };
}

// ---------- Boot ----------

if (AUTOTEST) {
  SPEED = SPEEDS.instant;
  const seed = Number(qs.get('seed') ?? 42);
  startGame(newGame({
    seed,
    players: [0, 1, 2, 3].map(i => ({
      name: PERSONALITIES[i].name, token: TOKENS[i], isAI: true, personality: i,
    })),
  }));
} else {
  buildSetup();
}
