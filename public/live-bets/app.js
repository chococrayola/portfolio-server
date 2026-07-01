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

const API_ROUTE = '/api/live-bets';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const DISPLAY_TZ = 'America/Puerto_Rico';

const SPORT_GROUP_ORDER = ['Puerto Rico', 'Basketball', 'Baseball', 'Football', 'Hockey', 'Soccer'];
// How often to re-poll for live status/score changes. ESPN-sourced games
// carry real status (scheduled/live/final) and scores; Odds API-sourced
// games don't (that endpoint only returns lines, not live state), so the
// ticker below will only ever surface ESPN-backed games.
const REFRESH_MS = 60 * 1000;

refresh();
setInterval(refresh, REFRESH_MS);

async function refresh() {
  let data = await loadFromServer();
  if (!data) data = await loadFromEspnFallback();
  const sections = data.sections || [];
  render(sections);
  renderTicker(sections);
  const updated = document.getElementById('updated');
  if (updated && data.generatedAt) {
    updated.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  }
}

async function loadFromServer() {
  try {
    const res = await fetch(API_ROUTE, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.sections)) return null;
    return data;
  } catch (err) {
    console.warn('live-bets: server route unavailable, falling back to ESPN —', err.message);
    return null;
  }
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
      return {
        sportKey: sport.sportKey,
        league: sport.league,
        sportGroup: sport.sportGroup,
        priority: false,
        oddsAvailable: false,
        status: games.length ? 'schedule-only' : 'unavailable',
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
    odds: null,
    source: 'espn',
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

  container.innerHTML = ordered.map(renderSection).join('');
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

function renderOdds(odds) {
  if (!odds) return '<span class="odds-pill odds-pill--muted">Odds N/A</span>';
  const parts = [];
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
