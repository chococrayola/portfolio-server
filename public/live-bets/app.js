// Live Bets Today — today's games across sports, Puerto Rico leagues pinned
// to the top when they're playing.
//
// Tries the server route first (/api/live-bets, which protects the paid
// odds API key and caches results). If that's unreachable — e.g. this page
// is served from static GitHub Pages hosting with no backend — it falls
// back to fetching free, keyless ESPN schedule data directly from the
// browser, using the same shared config files the server reads from, so the
// two paths can't drift out of sync. Either path produces the same
// `sections[]` shape, so rendering never needs to know which source it got.

// When this page is served from the same origin as the Express server
// (running locally, or if server.js itself serves public/), a relative
// fetch is enough. When it's served from GitHub Pages (a different origin
// than wherever server.js is deployed, e.g. Render), a relative fetch to
// "/api/live-bets" 404s against Pages itself — so BACKEND_BASE lets us also
// try the real backend's absolute URL before giving up and falling back to
// the keyless ESPN path. Leave this empty until a backend is deployed.
const BACKEND_BASE = '';
const API_ROUTE = '/api/live-bets';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const DISPLAY_TZ = 'America/Puerto_Rico';

const SPORT_GROUP_ORDER = ['Puerto Rico', 'Basketball', 'Baseball', 'Football', 'Hockey', 'Soccer'];
// How often to re-poll for live status/score changes. ESPN-sourced games
// carry real status (scheduled/live/final) and scores; Odds API-sourced
// games don't (that endpoint only returns lines, not live state), so the
// ticker below will only ever surface ESPN-backed games.
const REFRESH_MS = 60 * 1000;
// How often the "Top Bet" spotlight advances to the next candidate. This is
// a separate, faster timer from REFRESH_MS: the data itself only changes on
// each refresh, but cycling the displayed pick faster makes the widget feel
// alive between refreshes and gives every close matchup a turn in view.
const TOP_BET_ROTATE_MS = 5000;

let topBetsPool = [];
let topBetIndex = 0;

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(rotateTopBet, TOP_BET_ROTATE_MS);

async function refresh() {
  let data = await loadFromServer();
  if (!data) data = await loadFromEspnFallback();
  const sections = data.sections || [];
  render(sections);
  renderTicker(sections);
  topBetsPool = computeTopBets(sections);
  topBetIndex = 0;
  renderTopBet();
  const updated = document.getElementById('updated');
  if (updated && data.generatedAt) {
    updated.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  }
}

async function loadFromServer() {
  const candidates = [API_ROUTE];
  if (BACKEND_BASE) candidates.push(`${BACKEND_BASE.replace(/\/$/, '')}${API_ROUTE}`);

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data.sections)) continue;
      return data;
    } catch (err) {
      console.warn(`live-bets: ${url} unavailable —`, err.message);
    }
  }
  return null;
}

// --- Client-side ESPN-only fallback (no API key needed/possible here) ------

async function loadFromEspnFallback() {
  const [curatedSports, prCandidates, prKeywords] = await Promise.all([
    fetchJson('live-bets/curated-sports.json'),
    fetchJson('live-bets/pr-espn-candidates.json'),
    fetchJson('live-bets/pr-keywords.json'),
  ]);

  const curatedResults = await Promise.all(
    (curatedSports || []).map(async (sport) => {
      const games = filterToday(await fetchEspnScoreboard(sport.espnPath, sport));
      const oddsAvailable = games.some((g) => g.odds);
      return {
        sportKey: sport.sportKey,
        league: sport.league,
        sportGroup: sport.sportGroup,
        priority: false,
        oddsAvailable,
        status: oddsAvailable ? 'ok' : games.length ? 'schedule-only' : 'unavailable',
        games,
      };
    })
  );
  const curatedSections = curatedResults.filter((s) => s.games.length > 0);

  const prResults = await Promise.all(
    (prCandidates || []).map((c) => fetchEspnScoreboard(c.espnPath, c))
  );
  let prGames = filterToday(prResults.flat()).map((g) => ({ ...g, isPuertoRico: true }));

  for (const section of curatedSections) {
    const kept = [];
    for (const game of section.games) {
      if (isPuertoRico(game, prKeywords || [])) {
        prGames.push({ ...game, isPuertoRico: true });
      } else {
        kept.push(game);
      }
    }
    section.games = kept;
  }
  // A section can lose its only game(s) to the Puerto Rico hoist above —
  // drop it now rather than rendering an empty "0 games" card.
  const nonEmptyCuratedSections = curatedSections.filter((section) => section.games.length > 0);

  const sections = [];
  if (prGames.length) {
    sections.push({
      sportKey: 'puerto-rico',
      league: 'Puerto Rico',
      sportGroup: 'Puerto Rico',
      priority: true,
      oddsAvailable: false,
      status: 'schedule-only',
      games: prGames,
    });
  }
  sections.push(...nonEmptyCuratedSections);

  return { generatedAt: new Date().toISOString(), oddsApiConfigured: false, sections };
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`live-bets: failed to load ${url} —`, err.message);
    return null;
  }
}

async function fetchEspnScoreboard(espnPath, descriptor) {
  try {
    const res = await fetch(`${ESPN_BASE}/${espnPath}/scoreboard`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map((e) => normalizeEspnEvent(e, descriptor));
  } catch (err) {
    console.warn(`live-bets: espn fetch failed for ${espnPath} —`, err.message);
    return [];
  }
}

function normalizeEspnEvent(event, descriptor) {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const statusMap = { pre: 'scheduled', in: 'live', post: 'final' };
  return {
    id: `espn:${event.id}`,
    sportKey: descriptor.sportKey,
    league: descriptor.league,
    sportGroup: descriptor.sportGroup,
    startTime: event.date,
    status: statusMap[event.status?.type?.state] || 'scheduled',
    homeTeam: {
      name: home?.team?.displayName || 'TBD',
      shortName: home?.team?.abbreviation || null,
      logo: home?.team?.logo || null,
    },
    awayTeam: {
      name: away?.team?.displayName || 'TBD',
      shortName: away?.team?.abbreviation || null,
      logo: away?.team?.logo || null,
    },
    score:
      home?.score != null || away?.score != null
        ? { home: home?.score ?? null, away: away?.score ?? null }
        : null,
    venue: competition?.venue?.fullName || null,
    isPuertoRico: false,
    odds: extractEspnOdds(competition),
    source: 'espn',
  };
}

// ESPN's own scoreboard feed embeds real sportsbook odds when a partner has
// a line posted for that game (mainly NFL/NBA/MLB/NHL, before and during
// play) — no separate paid API needed. Coverage isn't guaranteed for every
// game/league, and this is unverified against live traffic since it can't
// be tested from a network-restricted environment, so treat early results
// as best-effort and sanity-check a game or two against a real sportsbook.
function extractEspnOdds(competition) {
  const entry = competition?.odds?.[0];
  if (!entry) return null;
  const home = entry.homeTeamOdds || {};
  const away = entry.awayTeamOdds || {};
  const hasMoneyline = home.moneyLine != null || away.moneyLine != null;
  const hasTotal = typeof entry.overUnder === 'number';
  const spread = buildEspnSpread(entry, home, away);
  if (!hasMoneyline && !hasTotal && !spread && !entry.details) return null;
  return {
    bookmaker: entry.provider?.name || null,
    summary: entry.details || null,
    moneyline: hasMoneyline ? { home: home.moneyLine ?? null, away: away.moneyLine ?? null } : null,
    spread,
    total: hasTotal
      ? {
          over: { point: entry.overUnder, price: entry.overOdds ?? null },
          under: { point: entry.overUnder, price: entry.underOdds ?? null },
        }
      : null,
  };
}

// ESPN tags each side with favorite/underdog booleans, which lets us assign
// the spread's sign deterministically (favorite is always negative) instead
// of guessing based on home/away — unlike a blind home/away assumption,
// this holds regardless of which side is actually favored.
function buildEspnSpread(entry, home, away) {
  const magnitude = typeof entry.spread === 'number' ? Math.abs(entry.spread) : null;
  if (magnitude === null) return null;
  // Require exactly one side to be *explicitly* true. A plain `===`
  // comparison would miss asymmetric shapes like { favorite: false } vs
  // an absent field (false !== undefined), which would otherwise let both
  // sides fall through as "not favorite" and produce an invalid
  // double-positive spread.
  const homeIsFavorite = home.favorite === true;
  const awayIsFavorite = away.favorite === true;
  if (homeIsFavorite === awayIsFavorite) return null; // neither or both — ambiguous, don't guess
  return {
    home: { point: homeIsFavorite ? -magnitude : magnitude, price: home.spreadOdds ?? null },
    away: { point: awayIsFavorite ? -magnitude : magnitude, price: away.spreadOdds ?? null },
  };
}

function isPuertoRico(game, keywords) {
  const haystack = `${game.league} ${game.homeTeam.name} ${game.awayTeam.name}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

function filterToday(games) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ });
  const todayStr = fmt.format(new Date());
  return games.filter((g) => g.startTime && fmt.format(new Date(g.startTime)) === todayStr);
}

// --- Rendering (source-agnostic: works for odds-api or espn sections) ------

function render(sections) {
  const loading = document.getElementById('loading');
  const empty = document.getElementById('empty');
  const container = document.getElementById('sections');
  if (loading) loading.hidden = true;

  if (!sections.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const ordered = [...sections].sort((a, b) => {
    const ai = SPORT_GROUP_ORDER.indexOf(a.sportGroup);
    const bi = SPORT_GROUP_ORDER.indexOf(b.sportGroup);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Live games also get a spotlight rail up top, in addition to staying
  // listed under their normal league section below — same pattern as the
  // ticker (a summary view doesn't replace the full grouped list).
  const liveGames = sections.flatMap((s) => s.games.filter((g) => g.status === 'live'));
  const liveBlock = liveGames.length ? renderLiveSection(liveGames) : '';
  const propsBlock = renderPlayerPropsSection(computeDemoPlayerProps(sections));

  container.innerHTML = liveBlock + ordered.map(renderSection).join('') + propsBlock;
}

function renderLiveSection(games) {
  return `
    <section class="league-block league-block--live">
      <div class="league-head">
        <h2>🔴 Live Now</h2>
        <span class="league-count">${games.length} game${games.length === 1 ? '' : 's'}</span>
      </div>
      <div class="league-games">${games.map(renderGameRow).join('')}</div>
    </section>`;
}

function renderSection(section) {
  const priorityClass = section.priority ? ' league-block--priority' : '';
  const badge = section.priority ? '<span class="priority-badge">🇵🇷 Priority</span>' : '';
  const note = sectionNote(section);
  const rows = section.games.length
    ? section.games.map(renderGameRow).join('')
    : '<p class="league-empty">No games available right now.</p>';

  return `
    <section class="league-block${priorityClass}">
      <div class="league-head">
        <h2>${escapeHtml(section.league)}</h2>
        ${badge}
        <span class="league-count">${section.games.length} game${section.games.length === 1 ? '' : 's'}</span>
      </div>
      ${note}
      <div class="league-games">${rows}</div>
    </section>`;
}

function sectionNote(section) {
  if (section.status === 'unavailable') {
    return '<p class="league-note">Live odds unavailable — showing what we could find.</p>';
  }
  if (section.status === 'schedule-only') {
    return '<p class="league-note">Schedule only — no betting lines available for this league.</p>';
  }
  return '';
}

function renderGameRow(game) {
  const time = game.startTime
    ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'TBD';
  const statusBadge =
    game.status === 'live' ? '<span class="game-status game-status--live">LIVE</span>' : game.status === 'final' ? '<span class="game-status">FINAL</span>' : `<span class="game-time">${escapeHtml(time)}</span>`;
  const scoreLine = game.score ? `<div class="game-score">${formatScoreLine(game)}</div>` : '';

  return `
    <div class="game-row">
      <div class="game-teams">
        <span class="team">${escapeHtml(game.awayTeam.name)}</span>
        <span class="at">@</span>
        <span class="team">${escapeHtml(game.homeTeam.name)}</span>
        ${scoreLine}
      </div>
      <div class="game-meta">${statusBadge}</div>
      <div class="game-odds">${renderOdds(game.odds)}</div>
    </div>`;
}

function formatScoreLine(game) {
  return `${escapeHtml(String(game.score.away ?? '—'))} - ${escapeHtml(String(game.score.home ?? '—'))}`;
}

// --- Live ticker: a scrolling banner of every game currently in progress ---
// Only ESPN-sourced games carry real live status/scores (the Odds API's
// basic odds endpoint doesn't include live state), so this will only ever
// surface games from the ESPN path — the curated odds sections above always
// show "scheduled" regardless of real-world game state.

function renderTicker(sections) {
  const ticker = document.getElementById('ticker');
  const track = document.getElementById('tickerTrack');
  if (!ticker || !track) return;

  const liveGames = sections.flatMap((s) => s.games.filter((g) => g.status === 'live'));
  if (!liveGames.length) {
    ticker.hidden = true;
    track.innerHTML = '';
    return;
  }

  const items = liveGames.map(tickerItemHtml).join('');
  // Duplicate the content so the CSS scroll animation can loop seamlessly
  // from -50% back to 0 without a visible jump.
  track.innerHTML = items + items;
  ticker.hidden = false;
}

function tickerItemHtml(game) {
  const score = game.score ? ` ${formatScoreLine(game)}` : '';
  return `
    <span class="ticker-item">
      <span class="ticker-live-dot"></span>
      ${escapeHtml(game.league)}: ${escapeHtml(game.awayTeam.name)} @ ${escapeHtml(game.homeTeam.name)}${score}
    </span>`;
}

// --- Player Props (DEMO DATA ONLY) ------------------------------------------
// There is no free source for real player props: ESPN's public feed doesn't
// expose them, and The Odds API only includes them on its $99/month
// Business tier. This generates clearly-labeled, obviously-synthetic sample
// props (generic "Top Performer" labels, never real athlete names) so the
// section shows the intended design without pretending to be real data.
// Numbers are seeded from the game id so they stay stable across refreshes
// instead of flickering to new fake values every poll.

const PROP_TEMPLATES = {
  Basketball: [
    { label: 'Points', min: 14, max: 32 },
    { label: 'Rebounds', min: 4, max: 12 },
  ],
  Baseball: [
    { label: 'Total Bases', min: 0.5, max: 2.5, step: 0.5 },
    { label: 'Strikeouts', min: 3, max: 8 },
  ],
  Football: [
    { label: 'Passing Yards', min: 200, max: 320 },
    { label: 'Receiving Yards', min: 40, max: 100 },
  ],
  Hockey: [{ label: 'Shots on Goal', min: 2, max: 6 }],
  Soccer: [{ label: 'Shots on Target', min: 1, max: 4 }],
};
const DEFAULT_PROP_TEMPLATES = [{ label: 'Points', min: 10, max: 25 }];

function computeDemoPlayerProps(sections) {
  const games = sections
    .flatMap((s) => s.games)
    .sort((a, b) => {
      const liveRank = (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1);
      if (liveRank !== 0) return liveRank;
      // A missing startTime should sort last, not first (new Date(0) would
      // otherwise rank it as "already started" ahead of real games).
      const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
      return aTime - bTime;
    })
    .slice(0, 3);

  return games.map((game) => {
    const rand = seededRandom(game.id);
    const templates = PROP_TEMPLATES[game.sportGroup] || DEFAULT_PROP_TEMPLATES;
    const sides = [
      { team: game.awayTeam, template: templates[0] },
      { team: game.homeTeam, template: templates[1 % templates.length] },
    ];
    const props = sides.map(({ team, template }) => ({
      playerLabel: `${team.shortName || team.name} Top Performer`,
      propLabel: template.label,
      line: randomLine(rand, template),
      overPrice: -110 - Math.floor(rand() * 3) * 5,
      underPrice: -110 - Math.floor(rand() * 3) * 5,
    }));
    return { game, props };
  });
}

// Real O/U lines are almost always set at a half-point specifically to
// avoid a push (tie), so force that here — a whole-number line would be an
// obvious tell that this is synthetic data, undermining the whole point of
// a look-alike demo.
function randomLine(rand, template) {
  const step = template.step || 1;
  const raw = template.min + rand() * (template.max - template.min);
  const stepped = Math.round(raw / step) * step;
  const rounded = Number(stepped.toFixed(1));
  return Number.isInteger(rounded) ? rounded + 0.5 : rounded;
}

// Deterministic PRNG seeded from a string (sfc32-style mix), so the same
// game id always produces the same "random" sequence.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = h >>> 0;
  return function next() {
    seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

function renderPlayerPropsSection(propsGames) {
  if (!propsGames.length) return '';
  return `
    <section class="league-block league-block--demo">
      <div class="league-head">
        <h2>🎯 Player Props</h2>
        <span class="demo-badge">DEMO</span>
      </div>
      <p class="league-note league-note--demo">
        ⚠️ Sample data for demonstration only — not real odds or real player stats.
      </p>
      <div class="league-games">${propsGames.map(renderPropGameBlock).join('')}</div>
    </section>`;
}

function renderPropGameBlock({ game, props }) {
  return `
    <div class="prop-game">
      <div class="prop-game-header">${escapeHtml(game.league)}: ${escapeHtml(game.awayTeam.name)} @ ${escapeHtml(game.homeTeam.name)}</div>
      ${props.map(renderPropRow).join('')}
    </div>`;
}

function renderPropRow(prop) {
  const overText = `O ${prop.line} (${formatPrice(prop.overPrice)})`;
  const underText = `U ${prop.line} (${formatPrice(prop.underPrice)})`;
  return `
    <div class="game-row">
      <div class="game-teams">
        <span class="team">${escapeHtml(prop.playerLabel)}</span>
        <span class="at">${escapeHtml(prop.propLabel)}</span>
      </div>
      <div class="game-odds">${oddsPill('O/U', overText, underText)}</div>
    </div>`;
}

// --- Top Bets: a rotating spotlight of the most competitive real-odds ------
// games right now. "Most competitive" is the closest we can get to "top" or
// "trending" without any real betting-volume data (this isn't an actual
// sportsbook) — it ranks by how close the two teams' implied win
// probabilities are, live games first. Games without real odds (most of the
// current ESPN-fallback coverage) simply aren't candidates.

function computeTopBets(sections) {
  const candidates = sections
    .flatMap((s) => s.games)
    .filter((g) => g.odds?.moneyline && g.odds.moneyline.home != null && g.odds.moneyline.away != null);

  return candidates
    .map((game) => ({
      game,
      closeness: Math.abs(
        impliedProbability(game.odds.moneyline.home) - impliedProbability(game.odds.moneyline.away)
      ),
    }))
    .sort((a, b) => {
      const liveRank = (a.game.status === 'live' ? 0 : 1) - (b.game.status === 'live' ? 0 : 1);
      return liveRank !== 0 ? liveRank : a.closeness - b.closeness;
    })
    .slice(0, 5)
    .map((entry) => entry.game);
}

function impliedProbability(americanOdds) {
  return americanOdds > 0 ? 100 / (americanOdds + 100) : -americanOdds / (-americanOdds + 100);
}

function rotateTopBet() {
  if (!topBetsPool.length) return;
  topBetIndex = (topBetIndex + 1) % topBetsPool.length;
  renderTopBet();
}

function renderTopBet() {
  const widget = document.getElementById('topBet');
  const content = document.getElementById('topBetContent');
  if (!widget || !content) return;

  if (!topBetsPool.length) {
    widget.hidden = true;
    return;
  }

  const game = topBetsPool[topBetIndex % topBetsPool.length];
  const liveTag = game.status === 'live' ? '<span class="game-status game-status--live">LIVE</span>' : '';
  content.innerHTML = `
    <span class="top-bet-league">${escapeHtml(game.league)}</span>
    <span class="top-bet-teams">${escapeHtml(game.awayTeam.name)} @ ${escapeHtml(game.homeTeam.name)}</span>
    ${liveTag}
    <span class="top-bet-odds">${renderOdds(game.odds)}</span>
    <span class="top-bet-index">${topBetIndex + 1}/${topBetsPool.length}</span>`;
  widget.hidden = false;
}

function renderOdds(odds) {
  if (!odds) return '<span class="odds-pill odds-pill--muted">Odds N/A</span>';
  const parts = [];
  if (odds.summary) {
    parts.push(`<span class="odds-pill odds-pill--summary">${escapeHtml(odds.summary)}</span>`);
  }
  if (odds.moneyline) {
    parts.push(oddsPill('ML', formatPrice(odds.moneyline.away), formatPrice(odds.moneyline.home)));
  }
  if (odds.spread) {
    parts.push(
      oddsPill(
        'Spread',
        formatSpread(odds.spread.away),
        formatSpread(odds.spread.home)
      )
    );
  }
  if (odds.total) {
    parts.push(oddsPill('Total', formatTotal(odds.total.over, 'O'), formatTotal(odds.total.under, 'U')));
  }
  return parts.join('') || '<span class="odds-pill odds-pill--muted">Odds N/A</span>';
}

function oddsPill(label, away, home) {
  return `<span class="odds-pill"><span class="odds-label">${escapeHtml(label)}</span> ${escapeHtml(away)} / ${escapeHtml(home)}</span>`;
}

function formatPrice(price) {
  if (price === null || price === undefined) return '—';
  return price > 0 ? `+${price}` : String(price);
}

function formatSpread(side) {
  if (!side || side.point === null || side.point === undefined) return '—';
  const point = side.point > 0 ? `+${side.point}` : side.point;
  return `${point} (${formatPrice(side.price)})`;
}

function formatTotal(side, prefix) {
  if (!side || side.point === null || side.point === undefined) return '—';
  return `${prefix} ${side.point}`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
