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

## Billiards Roulette

`public/billiards-roulette.html` is a pair of spinning wheels for pool night:
the **Game** wheel picks what you play (8-ball, 9-ball, one-pocket, …) and the
**Play Style** wheel picks the twist you play it with (opposite hand, banks
only, shot clock, …). Spin either wheel on its own, or hit **Spin both wheels**
for a combined pick. Every spin is logged in the history list.

Every wheel is fully editable from its **Edit options** panel: rename the
wheel, add / rename / delete options, switch options in or out of play
without deleting them, give an option a bigger slice (× odds, 1–10), or paste a
whole list into the bulk editor (one option per line; `Name | 3` sets odds,
`Name | off` keeps it in the list but out of spins). The "No repeats" toggle
makes every option come up once before any of them can repeat. Lists,
settings and history live in the browser's localStorage — nothing touches the
server, so the page works on GitHub Pages too.

Picks come from `crypto.getRandomValues` with rejection sampling (no modulo
bias) and are decided before the wheel starts turning; the number of turns
and where inside the winning slice the pointer stops are randomized on top of
that, so the animation only shows the result. To add a third wheel, append an
entry to `DEFAULT_WHEELS` in `public/billiards-roulette/app.js`.
