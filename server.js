const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // We will set these in Render later
    }
});

app.post('/send-request', (req, res) => {
    const { name, email, phone, services, message } = req.body;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: `New Request from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nServices: ${services}\n\nMessage: ${message}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) return res.status(500).send(error.toString());
        res.status(200).send('Success');
    });
});

// ---------------------------------------------------------------------------
// Live Bets Today — today's games across sports, with a Puerto Rico priority
// section. Real odds come from The Odds API (needs ODDS_API_KEY, free tier
// ~500 req/month); schedule-only data comes from ESPN's free public
// scoreboard endpoints (no key needed). See public/live-bets/*.json for the
// shared curated-league/keyword config also used by the client-side fallback
// in public/live-bets/app.js.
// ---------------------------------------------------------------------------

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const DISPLAY_TZ = 'America/Puerto_Rico';

const CURATED_SPORTS = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public/live-bets/curated-sports.json'), 'utf8')
);
const PR_ESPN_CANDIDATES = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public/live-bets/pr-espn-candidates.json'), 'utf8')
);
const PR_KEYWORDS = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public/live-bets/pr-keywords.json'), 'utf8')
);

// A single shared, 12h-TTL, all-visitors cache keeps worst-case Odds API
// usage well under the free 500/month quota even if every curated league
// were in-season simultaneously for a full month:
//   7 sports x (1440min/day / 720min TTL) x 30 days = 420 calls/month < 500
// MONTHLY_ODDS_BUDGET is a second, independent safety net in case that math
// is ever wrong (e.g. a lowered TTL, or credit costs changing upstream).
const ODDS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SPORTS_LIST_TTL_MS = 12 * 60 * 60 * 1000;
const ESPN_CACHE_TTL_MS = 15 * 60 * 1000;
const MONTHLY_ODDS_BUDGET = 450;

const oddsCache = new Map();
const espnCache = new Map();
let sportsListCache = { data: null, fetchedAt: 0 };
let sportsListInFlight = null;
const oddsInFlight = new Map();
let quotaUsage = { month: currentMonthKey(), count: 0 };

function currentMonthKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function canSpendOddsQuota() {
    const month = currentMonthKey();
    if (quotaUsage.month !== month) quotaUsage = { month, count: 0 };
    return quotaUsage.count < MONTHLY_ODDS_BUDGET;
}

// Free endpoint (not counted against quota) — tells us which curated
// leagues are actually in-season, so we never spend quota on e.g. NFL odds
// in July.
async function getInSeasonCuratedSports() {
    const now = Date.now();
    if (sportsListCache.data && now - sportsListCache.fetchedAt < SPORTS_LIST_TTL_MS) {
        return sportsListCache.data;
    }
    // De-dupe concurrent cache-miss requests so a burst of simultaneous
    // visitors triggers one upstream fetch, not one per request.
    if (sportsListInFlight) return sportsListInFlight;

    sportsListInFlight = (async () => {
        try {
            const res = await fetch(`${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`);
            if (!res.ok) throw new Error(`sports list responded ${res.status}`);
            const list = await res.json();
            const activeKeys = new Set(list.filter((s) => s.active).map((s) => s.key));
            const inSeason = CURATED_SPORTS.filter((s) => activeKeys.has(s.sportKey));
            sportsListCache = { data: inSeason, fetchedAt: now };
            return inSeason;
        } catch (err) {
            console.warn('live-bets: failed to fetch sports list —', err.message);
            // Fall back to the last known-good list rather than treating
            // every curated sport as out-of-season on a transient blip.
            return sportsListCache.data || [];
        } finally {
            sportsListInFlight = null;
        }
    })();
    return sportsListInFlight;
}

function pointPrice(outcome) {
    if (!outcome) return null;
    return { point: outcome.point ?? null, price: outcome.price ?? null };
}

function normalizeOddsApiEvent(event, sport) {
    const bookmaker =
        event.bookmakers?.find((b) => b.key === 'draftkings') || event.bookmakers?.[0] || null;
    let odds = null;
    if (bookmaker) {
        const h2h = bookmaker.markets?.find((m) => m.key === 'h2h');
        const spreads = bookmaker.markets?.find((m) => m.key === 'spreads');
        const totals = bookmaker.markets?.find((m) => m.key === 'totals');
        odds = {
            bookmaker: bookmaker.title,
            lastUpdated: bookmaker.last_update || null,
            moneyline: h2h
                ? {
                      home: h2h.outcomes.find((o) => o.name === event.home_team)?.price ?? null,
                      away: h2h.outcomes.find((o) => o.name === event.away_team)?.price ?? null,
                  }
                : null,
            spread: spreads
                ? {
                      home: pointPrice(spreads.outcomes.find((o) => o.name === event.home_team)),
                      away: pointPrice(spreads.outcomes.find((o) => o.name === event.away_team)),
                  }
                : null,
            total: totals
                ? {
                      over: pointPrice(totals.outcomes.find((o) => o.name === 'Over')),
                      under: pointPrice(totals.outcomes.find((o) => o.name === 'Under')),
                  }
                : null,
        };
    }
    return {
        id: `odds:${event.id}`,
        sportKey: sport.sportKey,
        league: sport.league,
        sportGroup: sport.sportGroup,
        startTime: event.commence_time,
        status: 'scheduled',
        homeTeam: { name: event.home_team, shortName: null, logo: null },
        awayTeam: { name: event.away_team, shortName: null, logo: null },
        venue: null,
        isPuertoRico: false,
        odds,
        source: 'odds-api',
    };
}

// Cache-first odds lookup for one curated sport. Never throws — any failure
// (missing key, quota exhausted, network/HTTP error) degrades to
// { status: 'unavailable' } so the caller can fall back to ESPN schedule
// data instead of breaking the whole response.
async function getOddsForSport(sport) {
    const now = Date.now();
    const cached = oddsCache.get(sport.sportKey);
    if (cached && now - cached.fetchedAt < ODDS_CACHE_TTL_MS) return cached;

    if (!ODDS_API_KEY || !canSpendOddsQuota()) {
        return { status: 'unavailable', games: [] };
    }

    if (oddsInFlight.has(sport.sportKey)) return oddsInFlight.get(sport.sportKey);

    const promise = (async () => {
        try {
            quotaUsage.count += 1;
            const url =
                `${ODDS_API_BASE}/sports/${sport.sportKey}/odds` +
                `?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&dateFormat=iso&oddsFormat=american`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`odds ${sport.sportKey} responded ${res.status}`);
            const events = await res.json();
            // Normalize each event independently — one malformed record
            // shouldn't blank out odds for the whole league.
            const games = [];
            for (const e of events) {
                try {
                    games.push(normalizeOddsApiEvent(e, sport));
                } catch (eventErr) {
                    console.warn(
                        `live-bets: skipping malformed event for ${sport.sportKey} —`,
                        eventErr.message
                    );
                }
            }
            const result = { status: 'ok', games, fetchedAt: now };
            oddsCache.set(sport.sportKey, result);
            return result;
        } catch (err) {
            console.warn(`live-bets: odds fetch failed for ${sport.sportKey} —`, err.message);
            return cached || { status: 'unavailable', games: [] };
        } finally {
            oddsInFlight.delete(sport.sportKey);
        }
    })();
    oddsInFlight.set(sport.sportKey, promise);
    return promise;
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
        venue: competition?.venue?.fullName || null,
        isPuertoRico: false,
        odds: null,
        source: 'espn',
    };
}

// Cache-first, keyless ESPN scoreboard lookup. Never throws — an unknown
// league slug, a 404, or a network error just yields an empty list, which
// lets callers drop that section rather than showing broken data.
async function fetchEspnScoreboard(espnPath, descriptor) {
    const now = Date.now();
    const cached = espnCache.get(espnPath);
    if (cached && now - cached.fetchedAt < ESPN_CACHE_TTL_MS) return cached.games;

    try {
        const res = await fetch(`${ESPN_BASE}/${espnPath}/scoreboard`);
        if (!res.ok) throw new Error(`espn ${espnPath} responded ${res.status}`);
        const data = await res.json();
        const games = (data.events || []).map((e) => normalizeEspnEvent(e, descriptor));
        espnCache.set(espnPath, { games, fetchedAt: now });
        return games;
    } catch (err) {
        console.warn(`live-bets: espn fetch failed for ${espnPath} —`, err.message);
        return cached?.games || [];
    }
}

function isPuertoRico(game) {
    const haystack = `${game.league} ${game.homeTeam.name} ${game.awayTeam.name}`.toLowerCase();
    return PR_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

function filterToday(games) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ }); // YYYY-MM-DD
    const todayStr = fmt.format(new Date());
    return games.filter((g) => g.startTime && fmt.format(new Date(g.startTime)) === todayStr);
}

app.get('/api/live-bets', async (req, res) => {
  try {
    const inSeason = ODDS_API_KEY ? await getInSeasonCuratedSports() : [];
    const inSeasonKeys = new Set(inSeason.map((s) => s.sportKey));

    const curatedResults = await Promise.allSettled(
        CURATED_SPORTS.map(async (sport) => {
            let games = [];
            let status = 'unavailable';

            if (ODDS_API_KEY && inSeasonKeys.has(sport.sportKey)) {
                const oddsResult = await getOddsForSport(sport);
                games = oddsResult.games;
                status = oddsResult.status;
            }

            if (status !== 'ok' && sport.espnPath) {
                const backstop = await fetchEspnScoreboard(sport.espnPath, sport);
                if (backstop.length) {
                    games = backstop;
                    status = 'schedule-only';
                }
            }

            return {
                sportKey: sport.sportKey,
                league: sport.league,
                sportGroup: sport.sportGroup,
                priority: false,
                oddsAvailable: status === 'ok',
                status,
                games: filterToday(games),
            };
        })
    );

    // Keep a curated section only if it actually has data today, or we
    // genuinely checked it (rather than cluttering the board with every
    // off-season league showing zero games).
    const curatedSections = curatedResults
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((section) => section.games.length > 0 || section.status !== 'unavailable');

    const prCandidateResults = await Promise.allSettled(
        PR_ESPN_CANDIDATES.map((c) => fetchEspnScoreboard(c.espnPath, c))
    );
    let prGames = filterToday(
        prCandidateResults.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    ).map((g) => ({ ...g, isPuertoRico: true }));

    // Also hoist any Puerto Rico game that surfaced inside a curated section
    // (e.g. a WBC/FIBA game featuring Puerto Rico's national team).
    for (const section of curatedSections) {
        const kept = [];
        for (const game of section.games) {
            if (isPuertoRico(game)) {
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
            oddsAvailable: prGames.some((g) => g.odds),
            status: prGames.some((g) => g.odds) ? 'ok' : 'schedule-only',
            games: prGames,
        });
    }
    sections.push(...nonEmptyCuratedSections);

    res.status(200).json({
        generatedAt: new Date().toISOString(),
        date: new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ }).format(new Date()),
        oddsApiConfigured: Boolean(ODDS_API_KEY),
        sections,
    });
  } catch (err) {
    console.error('live-bets: unhandled error building response —', err);
    res.status(500).json({ error: 'Failed to load live bets.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));