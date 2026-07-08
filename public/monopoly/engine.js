// Monopolio Boricua — rules engine. No DOM: runs in the browser and headless under Node.
// All randomness goes through the seeded RNG in state so games are reproducible.
//
// The io bridge is the only way the engine talks to the outside:
//   io.decide(pid, type, payload) -> Promise<choice>   (routed to a modal or to ai.js)
//   io.emit(event) -> Promise|void                      (animations, log rendering)

import {
  SPACES, GROUPS, CHANCE, CHEST, RAIL_RENTS,
  JAIL_POS, GO_SALARY, JAIL_FINE, START_CASH, BANK_HOUSES, BANK_HOTELS,
} from './data.js';

// ---------- RNG (mulberry32, seed lives in state) ----------

export function rand(state) {
  let t = (state.rngSeed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rollDie(state) {
  return 1 + Math.floor(rand(state) * 6);
}

function shuffled(state, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Game setup ----------

export function newGame(config) {
  const state = {
    phase: 'PRE_ROLL',
    rngSeed: (config.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    players: config.players.map((p, id) => ({
      id, name: p.name, token: p.token, isAI: !!p.isAI,
      personality: p.personality ?? null,
      cash: START_CASH, pos: 0, inJail: false, jailTurns: 0,
      jailCards: [], // deck names ('chance'|'chest') so cards return to the right deck
      doubles: 0, bankrupt: false,
    })),
    turn: 0,
    owned: {},           // spaceIdx -> { owner, level (0-4 houses, 5 = hotel), mortgaged }
    bank: { houses: BANK_HOUSES, hotels: BANK_HOTELS },
    decks: null,
    dice: [0, 0],
    lastCard: null,
    turnCount: 0,
    gameOver: false,
    winner: null,
  };
  state.decks = {
    chance: shuffled(state, CHANCE.map(c => c.id)),
    chest: shuffled(state, CHEST.map(c => c.id)),
  };
  return state;
}

// ---------- Queries ----------

export function spaceAt(i) { return SPACES[i]; }

export function groupOwnedBy(state, group, pid) {
  return GROUPS[group].members.every(m => state.owned[m]?.owner === pid);
}

export function countOwned(state, pid, type) {
  return SPACES.filter(s => s.type === type && state.owned[s.i]?.owner === pid).length;
}

export function rentFor(state, idx, diceTotal, mult = 1) {
  const s = SPACES[idx];
  const o = state.owned[idx];
  if (!o || o.mortgaged) return 0;
  if (s.type === 'prop') {
    if (o.level > 0) return s.rents[o.level];
    return groupOwnedBy(state, s.group, o.owner) ? s.rents[0] * 2 : s.rents[0];
  }
  if (s.type === 'rail') return RAIL_RENTS[countOwned(state, o.owner, 'rail') - 1] * mult;
  if (s.type === 'util') {
    const n = countOwned(state, o.owner, 'util');
    const factor = mult > 1 ? 10 : (n === 2 ? 10 : 4);
    return diceTotal * factor;
  }
  return 0;
}

function groupLevels(state, group) {
  return GROUPS[group].members.map(m => state.owned[m]?.level ?? 0);
}

function groupHasBuildings(state, group) {
  return GROUPS[group].members.some(m => (state.owned[m]?.level ?? 0) > 0);
}

export function canBuild(state, pid, idx) {
  const s = SPACES[idx];
  if (!s || s.type !== 'prop') return false;
  const o = state.owned[idx];
  if (!o || o.owner !== pid || o.mortgaged || o.level >= 5) return false;
  if (!groupOwnedBy(state, s.group, pid)) return false;
  if (GROUPS[s.group].members.some(m => state.owned[m].mortgaged)) return false;
  if (o.level > Math.min(...groupLevels(state, s.group))) return false; // even-build
  if (o.level === 4 ? state.bank.hotels < 1 : state.bank.houses < 1) return false; // stock
  const p = state.players[pid];
  return p.cash >= s.houseCost;
}

export function canSellBuilding(state, pid, idx) {
  const s = SPACES[idx];
  const o = state.owned[idx];
  if (!s || s.type !== 'prop' || !o || o.owner !== pid || o.level === 0) return false;
  return o.level >= Math.max(...groupLevels(state, s.group)); // even-sell
}

export function canMortgage(state, pid, idx) {
  const s = SPACES[idx];
  const o = state.owned[idx];
  if (!o || o.owner !== pid || o.mortgaged) return false;
  if (s.type === 'prop' && groupHasBuildings(state, s.group)) return false;
  return true;
}

export function canUnmortgage(state, pid, idx) {
  const o = state.owned[idx];
  return !!o && o.owner === pid && o.mortgaged &&
    state.players[pid].cash >= unmortgageCost(idx);
}

export function unmortgageCost(idx) {
  return Math.ceil(SPACES[idx].price * 0.55); // half price + 10% interest
}

export function legalActions(state, pid) {
  const idxs = Object.keys(state.owned).map(Number).filter(i => state.owned[i].owner === pid);
  return {
    build: idxs.filter(i => canBuild(state, pid, i)),
    sell: idxs.filter(i => canSellBuilding(state, pid, i)),
    mortgage: idxs.filter(i => canMortgage(state, pid, i)),
    unmortgage: idxs.filter(i => canUnmortgage(state, pid, i)),
    canTrade: state.players.some(q => !q.bankrupt && q.id !== pid),
  };
}

// Cash a player could still raise by selling every building and mortgaging everything.
export function liquidValue(state, pid) {
  let v = 0;
  for (const [k, o] of Object.entries(state.owned)) {
    if (o.owner !== pid) continue;
    const s = SPACES[+k];
    if (s.type === 'prop' && o.level > 0) v += o.level * s.houseCost / 2;
    if (!o.mortgaged) v += s.price / 2;
  }
  return v;
}

export function netWorth(state, pid) {
  let v = state.players[pid].cash;
  for (const [k, o] of Object.entries(state.owned)) {
    if (o.owner !== pid) continue;
    const s = SPACES[+k];
    if (s.type === 'prop' && o.level > 0) v += o.level * s.houseCost;
    v += o.mortgaged ? s.price / 2 : s.price;
  }
  return v;
}

// ---------- Mutations (used by turn flow; also exported for trades/manage UI) ----------

function transfer(state, fromPid, toPid, amount) {
  if (fromPid !== 'bank') state.players[fromPid].cash -= amount;
  if (toPid !== 'bank') state.players[toPid].cash += amount;
}

export function doBuild(state, pid, idx) {
  const s = SPACES[idx];
  const o = state.owned[idx];
  o.level++;
  if (o.level === 5) { state.bank.houses += 4; state.bank.hotels--; }
  else state.bank.houses--;
  state.players[pid].cash -= s.houseCost;
}

export function doSellBuilding(state, pid, idx) {
  // Selling a hotel steps down to 4 houses if the bank has them;
  // otherwise the whole hotel must be torn down (official rule).
  const s = SPACES[idx];
  const o = state.owned[idx];
  if (o.level === 5) {
    state.bank.hotels++;
    if (state.bank.houses >= 4) {
      state.bank.houses -= 4;
      o.level = 4;
      state.players[pid].cash += s.houseCost / 2;
    } else {
      o.level = 0;
      state.players[pid].cash += 5 * s.houseCost / 2;
    }
  } else {
    o.level--;
    state.bank.houses++;
    state.players[pid].cash += s.houseCost / 2;
  }
}

export function doMortgage(state, pid, idx) {
  state.owned[idx].mortgaged = true;
  state.players[pid].cash += SPACES[idx].price / 2;
}

export function doUnmortgage(state, pid, idx) {
  state.owned[idx].mortgaged = false;
  state.players[pid].cash -= unmortgageCost(idx);
}

// ---------- Trades ----------

function tradePropsValid(state, pid, props) {
  return props.every(i => {
    const o = state.owned[i];
    if (!o || o.owner !== pid) return false;
    const s = SPACES[i];
    if (s.type === 'prop' && groupHasBuildings(state, s.group)) return false;
    return true;
  });
}

export function tradeValid(state, trade) {
  const { from, to, give, get } = trade;
  const a = state.players[from], b = state.players[to];
  if (!a || !b || a.bankrupt || b.bankrupt || from === to) return false;
  if ((give.cash ?? 0) < 0 || (get.cash ?? 0) < 0) return false;
  if ((give.cash ?? 0) > a.cash || (get.cash ?? 0) > b.cash) return false;
  if ((give.jailCards ?? 0) > a.jailCards.length) return false;
  if ((get.jailCards ?? 0) > b.jailCards.length) return false;
  if (!tradePropsValid(state, from, give.props ?? [])) return false;
  if (!tradePropsValid(state, to, get.props ?? [])) return false;
  const total = (give.cash ?? 0) + (get.cash ?? 0) + (give.props ?? []).length +
    (get.props ?? []).length + (give.jailCards ?? 0) + (get.jailCards ?? 0);
  return total > 0;
}

async function applyTrade(state, io, trade) {
  const { from, to, give, get } = trade;
  transfer(state, from, to, give.cash ?? 0);
  transfer(state, to, from, get.cash ?? 0);
  const moveProps = async (props, newOwner) => {
    for (const i of props ?? []) {
      state.owned[i].owner = newOwner;
      if (state.owned[i].mortgaged) {
        // New owner pays the 10% interest fee on receiving a mortgaged deed.
        const fee = Math.ceil(SPACES[i].price * 0.05);
        state.players[newOwner].cash -= Math.min(fee, Math.max(0, state.players[newOwner].cash));
        await io.emit({ type: 'log', kind: 'info', text: `${state.players[newOwner].name} heredó la hipoteca de ${SPACES[i].name} (fee de ${fee}). El banco nunca pierde.` });
      }
    }
  };
  await moveProps(give.props, to);
  await moveProps(get.props, from);
  for (let n = 0; n < (give.jailCards ?? 0); n++) state.players[to].jailCards.push(state.players[from].jailCards.pop());
  for (let n = 0; n < (get.jailCards ?? 0); n++) state.players[from].jailCards.push(state.players[to].jailCards.pop());
  await io.emit({ type: 'trade', trade });
  await io.emit({ type: 'log', kind: 'trade', text: `🤝 ${state.players[from].name} y ${state.players[to].name} hicieron negocio. Firmado en una servilleta.` });
}

// ---------- Debt / bankruptcy ----------

// Charge `amount` to `debtor` in favor of `creditor` ('bank' or pid).
// Runs the raise-cash sub-flow when short; may end in bankruptcy.
async function charge(state, io, debtorPid, amount, creditor) {
  const p = state.players[debtorPid];
  state.phase = 'DEBT';
  while (p.cash < amount) {
    if (p.cash + liquidValue(state, debtorPid) < amount) {
      await bankrupt(state, io, debtorPid, creditor);
      state.phase = 'PRE_ROLL';
      return false;
    }
    const choice = await io.decide(debtorPid, 'raiseCash', {
      amount, creditor, actions: legalActions(state, debtorPid),
    });
    if (choice.action === 'sellBuilding' && canSellBuilding(state, debtorPid, choice.idx)) {
      doSellBuilding(state, debtorPid, choice.idx);
      await io.emit({ type: 'buildings', idx: choice.idx });
    } else if (choice.action === 'mortgage' && canMortgage(state, debtorPid, choice.idx)) {
      doMortgage(state, debtorPid, choice.idx);
      await io.emit({ type: 'log', kind: 'info', text: `${p.name} hipotecó ${SPACES[choice.idx].name} pa' pagar la deuda. Duro.` });
    } else if (choice.action === 'bankrupt') {
      await bankrupt(state, io, debtorPid, creditor);
      state.phase = 'PRE_ROLL';
      return false;
    }
    // Anything else (or an illegal pick): loop again — the decider sees the same payload.
  }
  transfer(state, debtorPid, creditor, amount);
  await io.emit({ type: 'cash', pid: debtorPid, delta: -amount, to: creditor });
  state.phase = 'PRE_ROLL';
  return true;
}

async function bankrupt(state, io, pid, creditor) {
  const p = state.players[pid];
  // Buildings go back to the bank for half price (cash joins the estate).
  for (const [k, o] of Object.entries(state.owned)) {
    if (o.owner !== pid) continue;
    const s = SPACES[+k];
    if (s.type === 'prop' && o.level > 0) {
      if (o.level === 5) { state.bank.hotels++; p.cash += 5 * s.houseCost / 2; }
      else { state.bank.houses += o.level; p.cash += o.level * s.houseCost / 2; }
      o.level = 0;
    }
  }
  const deeds = Object.keys(state.owned).map(Number).filter(i => state.owned[i].owner === pid);
  if (creditor !== 'bank') {
    const c = state.players[creditor];
    c.cash += Math.max(0, p.cash);
    for (const i of deeds) {
      state.owned[i].owner = creditor;
      if (state.owned[i].mortgaged) {
        const fee = Math.ceil(SPACES[i].price * 0.05);
        c.cash -= Math.min(fee, Math.max(0, c.cash));
      }
    }
    while (p.jailCards.length) c.jailCards.push(p.jailCards.pop());
  } else {
    for (const i of deeds) delete state.owned[i]; // deeds revert to the bank
    while (p.jailCards.length) {
      const deckName = p.jailCards.pop();
      const deck = deckName === 'chance' ? CHANCE : CHEST;
      state.decks[deckName].push(deck.find(c => c.effect.type === 'jailFree').id);
    }
  }
  p.cash = 0;
  p.bankrupt = true;
  p.inJail = false;
  await io.emit({ type: 'bankrupt', pid, creditor });
  checkGameOver(state);
  if (!state.gameOver && creditor === 'bank') {
    // Bank estates get auctioned off one deed at a time.
    for (const i of deeds) await runAuction(state, io, i);
  }
  if (state.gameOver) await io.emit({ type: 'gameover', winner: state.winner });
}

function checkGameOver(state) {
  const alive = state.players.filter(q => !q.bankrupt);
  if (alive.length === 1) {
    state.gameOver = true;
    state.winner = alive[0].id;
  }
}

// ---------- Auction ----------

async function runAuction(state, io, idx) {
  state.phase = 'AUCTION';
  const s = SPACES[idx];
  let active = state.players.filter(p => !p.bankrupt && p.cash > 0).map(p => p.id);
  let highBid = 0, highBidder = null;
  await io.emit({ type: 'auctionStart', idx });
  let cursor = 0;
  while (active.length > (highBidder === null ? 0 : 1)) {
    const pid = active[cursor % active.length];
    if (pid === highBidder) { cursor++; continue; }
    const p = state.players[pid];
    const choice = await io.decide(pid, 'auctionBid', {
      idx, highBid, highBidder, minBid: highBid + 1, maxBid: p.cash,
    });
    const bid = choice.bid | 0;
    if (!choice.pass && bid > highBid && bid <= p.cash) {
      highBid = bid; highBidder = pid;
      await io.emit({ type: 'auctionBid', idx, pid, bid });
      cursor++;
    } else {
      active = active.filter(x => x !== pid); // pass = out of this auction
      await io.emit({ type: 'auctionPass', idx, pid });
      if (cursor >= active.length) cursor = 0;
    }
  }
  if (highBidder !== null) {
    state.players[highBidder].cash -= highBid;
    state.owned[idx] = { owner: highBidder, level: 0, mortgaged: false };
    await io.emit({ type: 'auctionWon', idx, pid: highBidder, bid: highBid });
  } else {
    await io.emit({ type: 'auctionNobody', idx });
  }
  state.phase = 'PRE_ROLL';
}

// ---------- Cards ----------

function drawCard(state, deckName) {
  const id = state.decks[deckName].shift();
  const card = (deckName === 'chance' ? CHANCE : CHEST).find(c => c.id === id);
  if (card.effect.type !== 'jailFree') state.decks[deckName].push(id); // jail-free stays out while held
  return card;
}

async function applyCard(state, io, p, card, deckName) {
  const e = card.effect;
  state.lastCard = { deck: deckName, id: card.id };
  await io.emit({ type: 'card', pid: p.id, deck: deckName, card });
  switch (e.type) {
    case 'move':
      await moveTo(state, io, p, e.to, { collectGo: e.collectGo });
      break;
    case 'moveBack': {
      p.pos = (p.pos - e.n + 40) % 40;
      await io.emit({ type: 'move', pid: p.id, to: p.pos, teleport: true });
      await resolveLanding(state, io, p, state.dice[0] + state.dice[1]);
      break;
    }
    case 'nearest': {
      const stops = e.kind === 'rail' ? [5, 15, 25, 35] : [12, 28];
      const to = stops.find(x => x > p.pos) ?? stops[0];
      if (to <= p.pos) { p.cash += GO_SALARY; await io.emit({ type: 'passGo', pid: p.id }); }
      p.pos = to;
      await io.emit({ type: 'move', pid: p.id, to, teleport: true });
      await resolveLanding(state, io, p, state.dice[0] + state.dice[1], { rentMult: 2, utilOverride: e.kind === 'util' });
      break;
    }
    case 'money':
      if (e.amount >= 0) { p.cash += e.amount; await io.emit({ type: 'cash', pid: p.id, delta: e.amount }); }
      else await charge(state, io, p.id, -e.amount, 'bank');
      break;
    case 'perPlayer': {
      const others = state.players.filter(q => !q.bankrupt && q.id !== p.id);
      if (e.amount > 0) {
        for (const q of others) {
          if (p.bankrupt || q.bankrupt || state.gameOver) continue;
          await charge(state, io, q.id, e.amount, p.id);
        }
      } else {
        for (const q of others) {
          if (p.bankrupt || q.bankrupt || state.gameOver) break;
          await charge(state, io, p.id, -e.amount, q.id);
        }
      }
      break;
    }
    case 'repairs': {
      let cost = 0;
      for (const [k, o] of Object.entries(state.owned)) {
        if (o.owner !== p.id) continue;
        if (SPACES[+k].type !== 'prop') continue;
        cost += o.level === 5 ? e.hotel : o.level * e.house;
      }
      if (cost > 0) await charge(state, io, p.id, cost, 'bank');
      break;
    }
    case 'jailFree':
      p.jailCards.push(deckName);
      break;
    case 'goToJail':
      await sendToJail(state, io, p);
      break;
  }
}

// ---------- Movement & landing ----------

async function sendToJail(state, io, p) {
  p.pos = JAIL_POS;
  p.inJail = true;
  p.jailTurns = 0;
  p.doubles = 0;
  await io.emit({ type: 'jail', pid: p.id });
}

async function moveTo(state, io, p, to, { collectGo = true } = {}) {
  if (collectGo && to <= p.pos) {
    p.cash += GO_SALARY;
    await io.emit({ type: 'passGo', pid: p.id });
  }
  p.pos = to;
  await io.emit({ type: 'move', pid: p.id, to, teleport: true });
  await resolveLanding(state, io, p, state.dice[0] + state.dice[1]);
}

async function moveBy(state, io, p, steps) {
  const to = (p.pos + steps) % 40;
  if (to < p.pos || steps >= 40) {
    p.cash += GO_SALARY;
    await io.emit({ type: 'passGo', pid: p.id });
  }
  p.pos = to;
  await io.emit({ type: 'move', pid: p.id, to, steps });
  await resolveLanding(state, io, p, steps);
}

async function resolveLanding(state, io, p, diceTotal, opts = {}) {
  const s = SPACES[p.pos];
  await io.emit({ type: 'landed', pid: p.id, idx: p.pos });
  switch (s.type) {
    case 'prop': case 'rail': case 'util': {
      const o = state.owned[p.pos];
      if (!o) {
        await buyOrAuction(state, io, p, p.pos);
      } else if (o.owner !== p.id && !o.mortgaged) {
        let rent;
        if (opts.utilOverride) rent = diceTotal * 10;
        else rent = rentFor(state, p.pos, diceTotal, s.type === 'rail' ? (opts.rentMult ?? 1) : 1);
        await io.emit({ type: 'rentDue', pid: p.id, idx: p.pos, owner: o.owner, rent });
        await charge(state, io, p.id, rent, o.owner);
      }
      break;
    }
    case 'tax':
      await io.emit({ type: 'taxDue', pid: p.id, idx: p.pos, amount: s.amount });
      await charge(state, io, p.id, s.amount, 'bank');
      break;
    case 'chance':
      await applyCard(state, io, p, drawCard(state, 'chance'), 'chance');
      break;
    case 'chest':
      await applyCard(state, io, p, drawCard(state, 'chest'), 'chest');
      break;
    case 'gotojail':
      await sendToJail(state, io, p);
      break;
    default:
      break; // go / jail-visit / parking: nothing (official rules)
  }
}

async function buyOrAuction(state, io, p, idx) {
  const s = SPACES[idx];
  const canAfford = p.cash >= s.price;
  const choice = canAfford
    ? await io.decide(p.id, 'buyOrAuction', { idx, price: s.price })
    : { buy: false, forced: true };
  if (choice.buy && canAfford) {
    p.cash -= s.price;
    state.owned[idx] = { owner: p.id, level: 0, mortgaged: false };
    await io.emit({ type: 'bought', pid: p.id, idx, price: s.price });
  } else {
    await runAuction(state, io, idx);
  }
}

// ---------- Management (pre-roll) ----------

async function managementPhase(state, io, p) {
  state.phase = 'PRE_ROLL';
  let tradesTried = 0;
  for (let guard = 0; guard < 200; guard++) {
    const actions = legalActions(state, p.id);
    const choice = await io.decide(p.id, 'preRoll', { actions, tradesTried });
    if (!choice || choice.action === 'roll') return;
    if (choice.action === 'build' && canBuild(state, p.id, choice.idx)) {
      doBuild(state, p.id, choice.idx);
      const o = state.owned[choice.idx];
      await io.emit({ type: 'buildings', idx: choice.idx, pid: p.id, level: o.level });
    } else if (choice.action === 'sellBuilding' && canSellBuilding(state, p.id, choice.idx)) {
      doSellBuilding(state, p.id, choice.idx);
      await io.emit({ type: 'buildings', idx: choice.idx, pid: p.id, level: state.owned[choice.idx].level });
    } else if (choice.action === 'mortgage' && canMortgage(state, p.id, choice.idx)) {
      doMortgage(state, p.id, choice.idx);
      await io.emit({ type: 'mortgaged', idx: choice.idx, pid: p.id });
    } else if (choice.action === 'unmortgage' && canUnmortgage(state, p.id, choice.idx)) {
      doUnmortgage(state, p.id, choice.idx);
      await io.emit({ type: 'unmortgaged', idx: choice.idx, pid: p.id });
    } else if (choice.action === 'trade' && tradeValid(state, choice.trade)) {
      tradesTried++;
      const answer = await io.decide(choice.trade.to, 'tradeRespond', { trade: choice.trade });
      if (answer.accept) await applyTrade(state, io, choice.trade);
      else await io.emit({ type: 'tradeRejected', trade: choice.trade });
    } else if (choice.action === 'roll') {
      return;
    }
  }
}

// ---------- Jail ----------

// Returns true if the player gets to move this turn (dice already set), false if stuck.
async function jailPhase(state, io, p) {
  state.phase = 'JAIL';
  const options = { canPay: p.cash >= JAIL_FINE, cards: p.jailCards.length, attempt: p.jailTurns + 1 };
  const choice = await io.decide(p.id, 'jail', options);
  if (choice.action === 'card' && p.jailCards.length > 0) {
    const deckName = p.jailCards.pop();
    const deck = deckName === 'chance' ? CHANCE : CHEST;
    state.decks[deckName].push(deck.find(c => c.effect.type === 'jailFree').id);
    p.inJail = false;
    await io.emit({ type: 'jailOut', pid: p.id, how: 'card' });
    return 'freed';
  }
  if (choice.action === 'pay' && p.cash >= JAIL_FINE) {
    p.cash -= JAIL_FINE;
    p.inJail = false;
    await io.emit({ type: 'jailOut', pid: p.id, how: 'pay' });
    return 'freed';
  }
  // Roll for doubles
  const d1 = rollDie(state), d2 = rollDie(state);
  state.dice = [d1, d2];
  await io.emit({ type: 'dice', pid: p.id, dice: [d1, d2], inJail: true });
  if (d1 === d2) {
    p.inJail = false;
    p.doubles = 0; // freeing doubles do NOT grant another roll
    await io.emit({ type: 'jailOut', pid: p.id, how: 'doubles' });
    return 'rolled';
  }
  p.jailTurns++;
  if (p.jailTurns >= 3) {
    // Third failed attempt: must pay the fine and move by this roll.
    const paid = await charge(state, io, p.id, JAIL_FINE, 'bank');
    if (!paid) return 'stuck'; // went bankrupt paying the fine
    p.inJail = false;
    await io.emit({ type: 'jailOut', pid: p.id, how: 'forced' });
    return 'rolled';
  }
  await io.emit({ type: 'jailStay', pid: p.id, attempt: p.jailTurns });
  return 'stuck';
}

// ---------- Turn driver ----------

export async function runTurn(state, io) {
  if (state.gameOver) return;
  const p = state.players[state.turn];
  if (p.bankrupt) { advanceTurn(state); return; }
  await io.emit({ type: 'turnStart', pid: p.id });

  let again = true;
  while (again && !p.bankrupt && !state.gameOver) {
    again = false;
    await managementPhase(state, io, p);
    if (p.bankrupt || state.gameOver) break;

    if (p.inJail) {
      const result = await jailPhase(state, io, p);
      if (result === 'stuck') break;
      if (result === 'rolled') {
        // Move by the doubles/forced roll; no extra turn afterwards.
        await moveBy(state, io, p, state.dice[0] + state.dice[1]);
        break;
      }
      // 'freed' (paid or card): fall through to a normal roll below.
    }

    const d1 = rollDie(state), d2 = rollDie(state);
    state.dice = [d1, d2];
    await io.emit({ type: 'dice', pid: p.id, dice: [d1, d2] });
    if (d1 === d2) {
      p.doubles++;
      if (p.doubles >= 3) {
        await io.emit({ type: 'log', kind: 'jail', text: `${p.name} sacó TRES dobles seguidos. Eso es velocidad sospechosa. ¡Pa' dentro!` });
        await sendToJail(state, io, p);
        break;
      }
    } else {
      p.doubles = 0;
    }
    await moveBy(state, io, p, d1 + d2);
    if (d1 === d2 && !p.inJail && !p.bankrupt && !state.gameOver) again = true;
  }

  p.doubles = 0;
  if (!state.gameOver) advanceTurn(state);
  await io.emit({ type: 'turnEnd' });
}

function advanceTurn(state) {
  state.turnCount++;
  for (let n = 1; n <= state.players.length; n++) {
    const next = (state.turn + n) % state.players.length;
    if (!state.players[next].bankrupt) { state.turn = next; return; }
  }
}
