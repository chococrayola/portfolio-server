// Monopolio Boricua — bot brains. Pure functions: (state, pid, type, payload) -> choice.
// No DOM, no timers, no RNG — deterministic given the state, so soak tests are reproducible.

import { SPACES, GROUPS, PERSONALITIES } from './data.js';
import { canUnmortgage, unmortgageCost, groupOwnedBy } from './engine.js';

const BUILD_PRIORITY = ['orange', 'red', 'lblue', 'yellow', 'pink', 'green', 'dblue', 'brown'];

function persona(p) {
  return PERSONALITIES[p.personality % PERSONALITIES.length] ?? PERSONALITIES[0];
}

export function decide(state, pid, type, payload) {
  const p = state.players[pid];
  const P = persona(p);
  switch (type) {
    case 'preRoll': return preRoll(state, pid, P, payload);
    case 'buyOrAuction': return { buy: shouldBuy(state, pid, P, payload.idx) };
    case 'auctionBid': return auctionBid(state, pid, P, payload);
    case 'jail': return jailChoice(state, pid, P, payload);
    case 'raiseCash': return raiseCash(state, pid, P, payload);
    case 'tradeRespond': return { accept: evaluateTrade(state, pid, payload.trade) };
    default: return {};
  }
}

// 'completes' = buying finishes my set; 'blocks' = an opponent is one deed away from this group.
function strategic(state, pid, idx) {
  const s = SPACES[idx];
  if (s.type !== 'prop') return null;
  const members = GROUPS[s.group].members;
  const owners = members.filter(m => m !== idx).map(m => state.owned[m]?.owner);
  if (owners.length && owners.every(o => o === pid)) return 'completes';
  if (owners.length && owners.every(o => o !== undefined && o !== pid) && new Set(owners).size === 1) return 'blocks';
  return null;
}

function shouldBuy(state, pid, P, idx) {
  const s = SPACES[idx];
  const p = state.players[pid];
  if (p.cash < s.price) return false;
  const strat = strategic(state, pid, idx);
  if (strat && p.cash - s.price >= 40) return true;
  if (s.type === 'rail' || s.type === 'util') return p.cash - s.price >= P.reserve * 0.6;
  return p.cash - s.price >= P.reserve / P.aggro;
}

function auctionBid(state, pid, P, { idx, highBid, minBid }) {
  const s = SPACES[idx];
  const p = state.players[pid];
  const strat = strategic(state, pid, idx);
  const mult = strat === 'completes' ? 1.4 : strat === 'blocks' ? 1.15 : 0.85;
  const valuation = Math.floor(s.price * mult * P.aggro);
  const ceiling = Math.min(valuation, p.cash - Math.min(50, Math.floor(P.reserve / 4)));
  if (minBid > ceiling) return { pass: true };
  const step = Math.max(1, Math.ceil(highBid * 0.12 / 10) * 10);
  return { bid: Math.min(highBid + step < minBid ? minBid : highBid + step, ceiling) };
}

function opponentBuildings(state, pid) {
  let n = 0;
  for (const o of Object.values(state.owned)) {
    if (o.owner !== pid) n += o.level;
  }
  return n;
}

function jailChoice(state, pid, P, { canPay, cards }) {
  const p = state.players[pid];
  // Late game the board is a minefield — stay locked up and collect rent in peace.
  if (opponentBuildings(state, pid) >= 8) return { action: 'roll' };
  if (cards > 0) return { action: 'card' };
  if (canPay && p.cash >= 100) return { action: 'pay' };
  return { action: 'roll' };
}

function preRoll(state, pid, P, { actions, tradesTried }) {
  const p = state.players[pid];
  // 1. One trade attempt per turn: buy the deed that completes a set.
  if ((tradesTried ?? 0) === 0 && actions.canTrade) {
    const trade = proposeTrade(state, pid, P);
    if (trade) return { action: 'trade', trade };
  }
  // 2. Unmortgage when flush — set members and rails first.
  const unm = actions.unmortgage
    .filter(i => p.cash - unmortgageCost(i) >= P.reserve)
    .sort((a, b) => unmortgagePriority(state, pid, a) - unmortgagePriority(state, pid, b));
  if (unm.length) return { action: 'unmortgage', idx: unm[0] };
  // 3. Build on full sets while there's a cushion; spread to 3 houses before going taller.
  const buildable = actions.build
    .filter(i => p.cash - SPACES[i].houseCost >= P.reserve / P.buildLove)
    .sort((a, b) => buildScore(state, a) - buildScore(state, b));
  if (buildable.length) return { action: 'build', idx: buildable[0] };
  return { action: 'roll' };
}

function unmortgagePriority(state, pid, idx) {
  const s = SPACES[idx];
  if (s.type === 'prop' && groupOwnedBy(state, s.group, pid)) return 0;
  if (s.type === 'rail') return 1;
  if (s.type === 'prop') return 2;
  return 3;
}

function buildScore(state, idx) {
  const s = SPACES[idx];
  const level = state.owned[idx].level;
  const tier = level >= 3 ? 10 : 0; // finish 3 houses everywhere before hotels
  return tier + BUILD_PRIORITY.indexOf(s.group);
}

function raiseCash(state, pid, P, { actions }) {
  if (actions.sell.length) {
    // Sell the building whose current rent contribution is lowest.
    const best = actions.sell.slice().sort((a, b) =>
      SPACES[a].rents[state.owned[a].level] - SPACES[b].rents[state.owned[b].level])[0];
    return { action: 'sellBuilding', idx: best };
  }
  if (actions.mortgage.length) {
    const score = (i) => {
      const s = SPACES[i];
      if (s.type === 'util') return 0;
      if (s.type === 'prop' && !groupOwnedBy(state, s.group, pid)) return 1;
      if (s.type === 'rail') return 2;
      return 3; // full-set member: last resort
    };
    const best = actions.mortgage.slice()
      .sort((a, b) => score(a) - score(b) || SPACES[b].price - SPACES[a].price)[0];
    return { action: 'mortgage', idx: best };
  }
  return { action: 'bankrupt' };
}

// Offer cash for the one deed that completes a set of mine. Overpays on purpose:
// completing a monopoly is worth far more than face value, and it keeps games
// from stalemating into four landlords collecting $200 forever.
function proposeTrade(state, pid, P) {
  const p = state.players[pid];
  for (const def of Object.values(GROUPS)) {
    if (!def.members.every(m => state.owned[m])) continue;
    const mine = def.members.filter(m => state.owned[m].owner === pid);
    if (mine.length !== def.members.length - 1) continue; // one deed away
    const target = def.members.find(m => state.owned[m].owner !== pid);
    const s = SPACES[target];
    const base = s.price * (state.owned[target].mortgaged ? 0.5 : 1);
    // Covers the seller's "you're completing a set" premium (+0.5×price) plus their 10% margin.
    const cashOffer = Math.ceil((base + s.price * 0.5) * 1.15);
    if (p.cash - cashOffer < Math.max(P.reserve, 150)) continue;
    return {
      from: pid, to: state.owned[target].owner,
      give: { cash: cashOffer, props: [], jailCards: 0 },
      get: { cash: 0, props: [target], jailCards: 0 },
    };
  }
  return null;
}

function deedValue(state, pid, idx, receiving, counterparty) {
  const s = SPACES[idx];
  let v = s.price * (state.owned[idx]?.mortgaged ? 0.5 : 1);
  if (s.type === 'prop') {
    const others = GROUPS[s.group].members.filter(m => m !== idx);
    if (receiving && others.every(m => state.owned[m]?.owner === pid)) v += s.price * 0.6; // completes my set
    if (!receiving) {
      if (groupOwnedBy(state, s.group, pid)) v += s.price * 0.6; // breaks my set
      // Handing the other side a monopoly? Then they pay the monopoly premium.
      if (others.every(m => state.owned[m]?.owner === counterparty)) v += s.price * 0.5;
    }
  }
  return v;
}

// Called for the trade's target (trade.to): they receive `give`, hand over `get`.
export function evaluateTrade(state, pid, trade) {
  const other = trade.from === pid ? trade.to : trade.from;
  const val = (side, receiving) =>
    (side.cash ?? 0) + (side.jailCards ?? 0) * 25 +
    (side.props ?? []).reduce((sum, i) => sum + deedValue(state, pid, i, receiving, other), 0);
  const received = val(trade.give, true);
  const given = val(trade.get, false);
  return received >= given * 1.1;
}
