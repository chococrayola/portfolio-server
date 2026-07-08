// Monopolio Boricua — promise-based modal flows for human decisions.

import { SPACES, GROUPS, TOKEN_NAMES } from './data.js';
import { deedHTML, PLAYER_COLORS } from './board.js';
import {
  canBuild, canSellBuilding, canMortgage, canUnmortgage,
  unmortgageCost, netWorth, tradeValid,
} from './engine.js';

const root = () => document.getElementById('modal-root');

function open(html, cls = '') {
  const el = document.createElement('div');
  el.className = `modal ${cls}`;
  el.innerHTML = html;
  root().innerHTML = '';
  root().appendChild(el);
  return el;
}

export function closeModal() { root().innerHTML = ''; }
export function modalOpen() { return root().childElementCount > 0; }

// Simple informational deed popup (clicking a board space).
export function showDeedPopup(state, idx) {
  const el = open(`
    ${deedHTML(state, idx)}
    <div class="modal-actions"><button class="btn" data-x="close">Cerrar</button></div>`);
  el.querySelector('[data-x=close]').onclick = closeModal;
  root().onclick = (e) => { if (e.target === root()) closeModal(); };
}

// ---- Buy or auction ----
export function buyOrAuction(state, pid, { idx, price }) {
  return new Promise((resolve) => {
    const p = state.players[pid];
    const el = open(`
      <h2>${p.token} ${p.name}, ¿lo compras o se subasta?</h2>
      ${deedHTML(state, idx)}
      <div class="modal-actions">
        <button class="btn" data-x="auction">A subasta 🔨</button>
        <button class="btn primary" data-x="buy">Comprar por $${price}</button>
      </div>
      <p class="hint">Regla oficial: si no lo compras, se subasta entre TODOS. Sí, tú también puedes pujar. Sí, es raro. Sí, es legal.</p>`);
    el.querySelector('[data-x=buy]').onclick = () => { closeModal(); resolve({ buy: true }); };
    el.querySelector('[data-x=auction]').onclick = () => { closeModal(); resolve({ buy: false }); };
  });
}

// ---- Jail ----
export function jailModal(state, pid, { canPay, cards, attempt }) {
  return new Promise((resolve) => {
    const p = state.players[pid];
    const el = open(`
      <h2>🚔 ${p.token} ${p.name}, estás en el Oso Blanco</h2>
      <p>Intento ${attempt} de 3. Al tercero sin dobles, pagas los $50 a juro.</p>
      <div class="modal-actions">
        <button class="btn" data-x="roll">🎲 Tirar (dobles = libre)</button>
        <button class="btn" data-x="card" ${cards ? '' : 'disabled'}>🎟️ Usar tarjeta (${cards})</button>
        <button class="btn primary" data-x="pay" ${canPay ? '' : 'disabled'}>💵 Pagar $50</button>
      </div>
      <p class="hint">La abuela ya sabe. Todo el barrio ya sabe.</p>`);
    el.querySelector('[data-x=roll]').onclick = () => { closeModal(); resolve({ action: 'roll' }); };
    el.querySelector('[data-x=card]').onclick = () => { closeModal(); resolve({ action: 'card' }); };
    el.querySelector('[data-x=pay]').onclick = () => { closeModal(); resolve({ action: 'pay' }); };
  });
}

// ---- Card reveal (humans confirm; bots use the center card) ----
export function cardModal(deckName, card) {
  return new Promise((resolve) => {
    const el = open(`
      <div class="card-flip">
        <div class="card-deck-name">${deckName === 'chance' ? '¿QUÉ PASÓ? ❓' : 'EL CORILLO 📦'}</div>
        <div class="card-text">${card.text}</div>
      </div>
      <div class="modal-actions"><button class="btn primary" data-x="ok">¡Dale!</button></div>`);
    el.querySelector('[data-x=ok]').onclick = () => { closeModal(); resolve(); };
  });
}

// ---- Manage properties (also the debt / raise-cash UI) ----
// Resolves with ONE action per call; the engine re-asks and main reopens us.
export function managePanel(state, pid, { debt } = {}) {
  return new Promise((resolve) => {
    const p = state.players[pid];
    const mine = Object.keys(state.owned).map(Number)
      .filter(i => state.owned[i].owner === pid)
      .sort((a, b) => (SPACES[a].group ?? 'zz').localeCompare(SPACES[b].group ?? 'zz') || a - b);

    const rows = mine.map(i => {
      const s = SPACES[i];
      const o = state.owned[i];
      const sw = s.group ? GROUPS[s.group].color : '#345';
      const stateTxt = o.mortgaged ? 'hipotecada'
        : o.level === 5 ? 'HOTEL 🏨' : o.level > 0 ? `${o.level} casa${o.level > 1 ? 's' : ''}` : '';
      const btns = [];
      if (canBuild(state, pid, i)) btns.push(`<button class="btn small primary" data-a="build" data-i="${i}">+🏠 $${s.houseCost}</button>`);
      if (canSellBuilding(state, pid, i)) btns.push(`<button class="btn small" data-a="sellBuilding" data-i="${i}">Vender 🏠 +$${s.houseCost / 2}</button>`);
      if (canMortgage(state, pid, i)) btns.push(`<button class="btn small" data-a="mortgage" data-i="${i}">Hipotecar +$${s.price / 2}</button>`);
      if (canUnmortgage(state, pid, i)) btns.push(`<button class="btn small" data-a="unmortgage" data-i="${i}">Levantar −$${unmortgageCost(i)}</button>`);
      return `<div class="prop-row">
        <span class="swatch" style="background:${sw}"></span>
        <span class="prop-name">${s.name}</span>
        <span class="prop-state">${stateTxt}</span>
        <span class="btn-group">${btns.join('') || '<span class="prop-state">—</span>'}</span>
      </div>`;
    }).join('') || '<p class="hint">No tienes ná. Ni un solar. Óyeme, qué triste.</p>';

    const el = open(`
      ${debt ? `<div class="debt-banner">💸 DEBES $${debt.amount} ${debt.creditorName ? `a ${debt.creditorName}` : 'al banco'} — tienes $${p.cash}. ¡Resuelve!</div>` : ''}
      <h2>🏠 Propiedades de ${p.token} ${p.name} <small>($${p.cash})</small></h2>
      <div class="prop-list">${rows}</div>
      <div class="modal-actions">
        ${debt ? `<button class="btn danger" data-a="bankrupt">💀 Declararme en quiebra</button>` : `<button class="btn" data-a="close">Cerrar</button>`}
      </div>
      ${state.bank.houses === 0 ? '<p class="hint">⚠️ ¡No hay cemento! El banco se quedó sin casas.</p>' : ''}`);

    el.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'bankrupt') {
          if (!confirm('¿Seguro? Esto es quiebra REAL. Te vas del juego con las manos vacías y el orgullo herido.')) return;
          closeModal();
          resolve({ action: 'bankrupt' });
        } else if (a === 'close') {
          resolve({ action: 'close' }); // caller decides whether to close the modal
        } else {
          resolve({ action: a, idx: Number(b.dataset.i) });
        }
      };
    });
  });
}

// ---- Auction panel ----
// Persistent across engine decide-calls. `view` lives in main.js.
export function renderAuction(state, view, human) {
  const s = SPACES[view.idx];
  const bidders = state.players.filter(p => !p.bankrupt).map(p => {
    const out = view.out.has(p.id);
    const leader = view.highBidder === p.id;
    return `<div class="auction-bidder ${leader ? 'leader' : ''} ${out ? 'out' : ''}">
      <span>${p.token}</span><span>${p.name}</span>
      <span style="margin-left:auto">${leader ? `manda con $${view.highBid}` : out ? 'se rajó' : '$' + p.cash}</span>
    </div>`;
  }).join('');

  const humanControls = human ? `
    <div class="auction-high">Puja: $<span id="bid-amt">${human.minBid}</span></div>
    <div class="bid-buttons">
      <button class="btn small" data-inc="1">+$1</button>
      <button class="btn small" data-inc="10">+$10</button>
      <button class="btn small" data-inc="50">+$50</button>
      <button class="btn small" data-inc="max">Max ($${human.maxBid})</button>
    </div>
    <div class="modal-actions">
      <button class="btn danger" data-x="pass">Me rajo 🏳️</button>
      <button class="btn primary" data-x="bid">¡Pujar! 🔨</button>
    </div>` : '<p class="hint" style="text-align:center">Los bots están pujando…</p>';

  const el = open(`
    <h2>🔨 Subasta: ${s.name}</h2>
    ${deedHTML(state, view.idx)}
    <div class="auction-high">${view.highBidder === null ? 'Sin pujas todavía' : `Va en $${view.highBid}`}</div>
    <div class="auction-bidders">${bidders}</div>
    ${humanControls}`, 'auction-modal');

  if (!human) return null;
  return new Promise((resolve) => {
    let amt = human.minBid;
    const amtEl = el.querySelector('#bid-amt');
    el.querySelectorAll('[data-inc]').forEach(b => {
      b.onclick = () => {
        amt = b.dataset.inc === 'max' ? human.maxBid : Math.min(human.maxBid, amt + Number(b.dataset.inc));
        amtEl.textContent = amt;
      };
    });
    el.querySelector('[data-x=bid]').onclick = () => resolve({ bid: amt });
    el.querySelector('[data-x=pass]').onclick = () => resolve({ pass: true });
    if (human.maxBid < human.minBid) {
      el.querySelector('[data-x=bid]').disabled = true;
    }
  });
}

// ---- Trade builder ----
function tradableProps(state, pid) {
  return Object.keys(state.owned).map(Number).filter(i => {
    const o = state.owned[i];
    if (o.owner !== pid) return false;
    const s = SPACES[i];
    if (s.type === 'prop' && GROUPS[s.group].members.some(m => (state.owned[m]?.level ?? 0) > 0)) return false;
    return true;
  });
}

export function tradeBuilder(state, pid) {
  return new Promise((resolve) => {
    const me = state.players[pid];
    const partners = state.players.filter(q => !q.bankrupt && q.id !== pid);
    let partner = partners[0].id;

    const render = () => {
      const other = state.players[partner];
      const col = (owner, side) => {
        const props = tradableProps(state, owner.id).map(i => {
          const s = SPACES[i];
          const sw = s.group ? GROUPS[s.group].color : '#345';
          return `<label class="trade-item"><input type="checkbox" data-side="${side}" value="${i}">
            <span class="swatch" style="background:${sw}"></span>${s.name}${state.owned[i].mortgaged ? ' (hip.)' : ''}</label>`;
        }).join('') || '<p class="hint">Nada tradeable (los sets con casas no se tocan).</p>';
        return `
          <div class="trade-col">
            <h4>${owner.token} ${owner.name} da:</h4>
            ${props}
            <label class="trade-item">💵 Cash: <input type="number" class="trade-cash" data-cash="${side}" min="0" max="${owner.cash}" value="0"></label>
            ${owner.jailCards.length ? `<label class="trade-item"><input type="checkbox" data-jail="${side}">🎟️ Tarjeta de salir de la cárcel (${owner.jailCards.length})</label>` : ''}
          </div>`;
      };
      const el = open(`
        <h2>🤝 Negociar (estilo pulguero)</h2>
        <div class="setup-row"><label>¿Con quién?</label>
          <select id="trade-partner" class="trade-cash" style="width:auto">
            ${partners.map(q => `<option value="${q.id}" ${q.id === partner ? 'selected' : ''}>${q.token} ${q.name}</option>`).join('')}
          </select>
        </div>
        <div class="trade-cols">${col(me, 'give')}${col(other, 'get')}</div>
        <div class="modal-actions">
          <button class="btn" data-x="cancel">Olvídalo</button>
          <button class="btn primary" data-x="propose">Proponer 🤝</button>
        </div>
        <p class="hint">El otro puede decir que no. Como en la vida.</p>`);

      el.querySelector('#trade-partner').onchange = (e) => { partner = Number(e.target.value); render(); };
      el.querySelector('[data-x=cancel]').onclick = () => { closeModal(); resolve(null); };
      el.querySelector('[data-x=propose]').onclick = () => {
        const side = (name) => ({
          cash: Number(el.querySelector(`[data-cash="${name}"]`)?.value || 0),
          props: [...el.querySelectorAll(`input[data-side="${name}"]:checked`)].map(x => Number(x.value)),
          jailCards: el.querySelector(`[data-jail="${name}"]`)?.checked ? 1 : 0,
        });
        const trade = { from: pid, to: partner, give: side('give'), get: side('get') };
        if (!tradeValid(state, trade)) {
          alert('Ese trade no cuadra: tiene que haber algo en la mesa y los números tienen que dar.');
          return;
        }
        closeModal();
        resolve(trade);
      };
    };
    render();
  });
}

export function tradeRespond(state, pid, trade) {
  return new Promise((resolve) => {
    const from = state.players[trade.from];
    const me = state.players[pid];
    const list = (side) => {
      const bits = [];
      if (side.cash) bits.push(`💵 $${side.cash}`);
      for (const i of side.props ?? []) bits.push(`${SPACES[i].name}${state.owned[i].mortgaged ? ' (hipotecada)' : ''}`);
      if (side.jailCards) bits.push(`🎟️ ${side.jailCards} tarjeta(s) de la cárcel`);
      return bits.map(b => `<li>${b}</li>`).join('') || '<li>nada 😐</li>';
    };
    const el = open(`
      <h2>🤝 ${from.token} ${from.name} te propone un negocio, ${me.token} ${me.name}</h2>
      <div class="trade-cols">
        <div class="trade-col"><h4>Te da:</h4><ul>${list(trade.give)}</ul></div>
        <div class="trade-col"><h4>Le das:</h4><ul>${list(trade.get)}</ul></div>
      </div>
      <div class="modal-actions">
        <button class="btn danger" data-x="no">Ni loco 🙅</button>
        <button class="btn primary" data-x="yes">Trato hecho 🤝</button>
      </div>
      <p class="hint">Consejo de abuela: si suena demasiado bueno, revisa dos veces.</p>`);
    el.querySelector('[data-x=yes]').onclick = () => { closeModal(); resolve({ accept: true }); };
    el.querySelector('[data-x=no]').onclick = () => { closeModal(); resolve({ accept: false }); };
  });
}

// ---- Game over ----
export function gameOver(state, personaOf) {
  return new Promise((resolve) => {
    const winner = state.players[state.winner];
    const rows = state.players
      .map(p => ({ p, nw: p.bankrupt ? 0 : netWorth(state, p.id) }))
      .sort((a, b) => b.nw - a.nw)
      .map(({ p, nw }) => `<tr>
        <td>${p.token} ${p.name}${p.id === state.winner ? ' 👑' : ''}</td>
        <td class="epitaph">${p.bankrupt ? epitaph(p) : (p.id === state.winner ? 'Dueño de la isla entera' : 'sobrevivió')}</td>
        <td>$${nw}</td>
      </tr>`).join('');
    const quip = personaOf?.(winner)?.quips?.win?.[0] ?? '';
    const el = open(`
      <div class="winner-splash">🏆🇵🇷</div>
      <h2 style="text-align:center">¡${winner.token} ${winner.name} es dueño de TODA la isla!</h2>
      ${quip ? `<p style="text-align:center" class="epitaph">"${quip}"</p>` : ''}
      <table class="networth-table">
        <tr><th>Jugador</th><th>Destino</th><th>Fortuna</th></tr>${rows}
      </table>
      <div class="modal-actions">
        <button class="btn primary big" data-x="again">Otra vez 🔁</button>
      </div>
      <p class="hint">Hasta LUMA quedó impresionada. Y LUMA no se impresiona con nada.</p>`);
    el.querySelector('[data-x=again]').onclick = () => resolve();
  });
}

function epitaph(p) {
  const options = [
    'quebró vendiendo hasta la chancleta',
    'se fue como se fue la luz: sin avisar',
    'ahora vive del cafecito de los demás',
    'donó su fortuna (involuntariamente)',
  ];
  return options[p.id % options.length];
}
