# portfolio-server

Express server for a personal portfolio site. Serves the static apps in
`public/` and handles a contact-form email endpoint.

## Environment variables

| Variable       | Required | Purpose                                                        |
|----------------|----------|-----------------------------------------------------------------|
| `EMAIL_USER`   | yes      | Gmail account used to send contact-form mail (`/send-request`) |
| `EMAIL_PASS`   | yes      | Gmail app password for `EMAIL_USER`                             |
| `ODDS_API_KEY` | no       | Enables live betting odds on `/live-bets.html` via [the-odds-api.com](https://the-odds-api.com/) |

Copy these into a local `.env` file (gitignored) for development. On Render
(or wherever the server is deployed), set them under the service's
Environment tab.

`ODDS_API_KEY`: get a free key at https://the-odds-api.com/ (free tier is
~500 requests/month). If unset, `GET /api/live-bets` still works — every
league section falls back to free ESPN schedule data with no betting lines,
and the response includes `oddsApiConfigured: false` so the frontend can
message accordingly. The Puerto Rico priority section never needs this key
at all, since PR leagues (e.g. BSN) aren't tracked by mainstream odds
providers.

## Live Bets Today

`public/live-bets.html` shows today's games across major sports leagues,
with a Puerto Rico priority section pinned to the top whenever a PR-related
game (e.g. BSN) is found for the day. It tries the server route
`GET /api/live-bets` first (real odds, protected API key, cached
server-side); if that route isn't reachable — e.g. when the site is served
purely as static files (GitHub Pages) with no backend — it falls back to
fetching free ESPN schedule data directly from the browser, so the page
still works, just without betting lines.

### Deploying the backend (for real odds)

GitHub Pages only serves static files, so the `/api/live-bets` route (and
real betting odds) require running `server.js` somewhere. A `render.yaml`
Blueprint is included for a one-click deploy on [Render](https://render.com)
(free tier):

1. Get a free key at https://the-odds-api.com/.
2. Go to https://dashboard.render.com/select-repo?type=blueprint, connect
   this GitHub repo, and Render will read `render.yaml` automatically.
3. When prompted for environment variables, fill in `EMAIL_USER`,
   `EMAIL_PASS`, and `ODDS_API_KEY`.
4. Deploy. You'll get a URL like `https://portfolio-server-xxxx.onrender.com`.
   The free tier spins down after ~15 min idle, so the first request after
   a period of inactivity takes 30-60s to wake up.

## Parallel Live Simulator

`public/parallel-live.html` is a phone-first "go live" simulator: your camera
with a simulated audience (viewers, comments, questions, hearts). It runs
entirely in the browser; nothing is sent anywhere.

It installs as a phone app from its page: on Android, Chrome's menu → **Install
app**; on iPhone, Safari's Share button → **Add to Home Screen**. The name,
icons and full-screen launch come from `public/parallel-live/manifest.webmanifest`
and the icons beside it. `public/parallel-live-sw.js` keeps the page, its icons
and the Tailwind script available offline. It is registered with scope
`parallel-live`, so it never handles the site's other pages. The page is always
fetched fresh when online, but the icons and manifest are served from the
cache: when you change them (or add files to the worker's `FILES` list), bump
`CACHE` in the worker so phones pick up the new versions.
