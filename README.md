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
