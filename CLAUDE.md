# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

Single-file static web app: `index.html` contains all HTML, CSS, and JS. There is no package.json, no build, no test suite, no bundler. Vanilla JS, no frameworks. To "run" it, open the file in a browser (or serve the directory with any static server, e.g. `python3 -m http.server`). Edits are live on refresh.

## Deployment

Hosted on **GitHub Pages**: https://curt847.github.io/nba-pool/

Source: `main` branch, root directory. Pushing to `main` automatically rebuilds and publishes. Remote is `git@github.com:curt847/nba-pool.git` over SSH.

## Architecture

The frontend is a pure thin client backed by a **Google Apps Script Web App** acting as the API + database. The script URL lives in `CONFIG.PROXY_URL` (top of the `<script>` block in `index.html`). All persistence — players, PINs, picks, odds, ESPN-synced series state — is owned by that Apps Script; the browser keeps only an ephemeral mirror in `state`.

Calls go over **JSONP** (`apiCall(action, payload)` injects a `<script>` tag with a callback). Apps Script returns `{success, data, error}` wrapped in the callback. JSONP is used because Apps Script Web Apps don't reliably support CORS preflight for POST. Don't try to convert this to `fetch` without first verifying the Apps Script side handles it.

Known API actions invoked from the client:
- `getState` — pull players + series + lastUpdated
- `register`, `submitPicks`
- `syncScores` — admin-only, refreshes ESPN-derived series data on the server
- `adminSetOdds`, `adminAddPlayer`, `adminResetPin`, `adminRemovePlayer`, `adminDeletePick`

The Apps Script source is tracked at **`apps-script/Code.js`** in this repo and synced via [clasp](https://github.com/google/clasp). It's a **container-bound script** attached to the `NBA Pool Odds` Google Sheet (the data store). See `apps-script/README.md` for the scriptId, sheet link, and pull/push commands. Server-side changes still require a redeploy in the Apps Script editor (or `clasp deploy`) to take effect at the live `PROXY_URL` — pushing source via `clasp push` only updates the editor's "head," not what the deployment serves.

### Client state model

`state` (single global) holds `{players, series, currentPlayer, currentPin, isAdmin, lastUpdated, loading}`. `pendingPicks` is a separate global that holds in-progress (unsubmitted) picks keyed by series id.

`series` is the source of truth for status (`pre`/`live`/`post`/`tbd`), winner, game count, team metadata (including `seed`, `logo`, `wins`), and odds. ESPN-derived fields are written by the server's `syncScores`; **odds are commissioner-entered** and the only thing the admin UI sets per-series. The client de-dupes series in `loadState()` because ESPN occasionally returns the same matchup with two different IDs.

Picks are immutable once a series goes `live` (status flips server-side). The "undo pick" button only works while status is `pre` and is implemented by calling the admin `adminDeletePick` endpoint with the embedded admin password — a known design choice, not a bug. The PIN check on `submitPicks` is server-side.

### Scoring

Scoring is **all client-side** — `calcWinnings()`, `calcLivePotential()`, `calcPayout()`, `roundMultiplier()`, `applyMultiplier()`. The server stores raw picks + outcomes; points are recomputed on every render. Rules are also rendered in `renderRulesModal()` and must stay in sync with the math:
- Base payout = $100 stake + win-amount-on-$100-bet at the moneyline (e.g. -500 → 120, +380 → 480)
- Correct game count → ×1.5
- Round multipliers: R1 1×, R2 1.1×, CF 1.25×, Finals 1.5× — applied to the full payout (including the games bonus)

If you change the formula in one place, change it in the other.

### Render model

`render()` rewrites `#app` `innerHTML` from scratch on every state change — there is no virtual DOM, no diffing, no event delegation framework. Event handlers are inline `onclick="..."` attributes calling globals. When adding a new handler, attach it to `window` (top-level `function` declarations already do this). `refreshPickPanel()` is a partial re-render to avoid losing focus while the user is mid-pick — preserve that pattern if you add similar in-place updates.

Auto-refresh runs every `CONFIG.REFRESH_INTERVAL` ms (120s) via `setInterval` in `init()`.

## Things that look like bugs but aren't

- `ADMIN_PASSWORD` is hard-coded in client config (`commish2026`). This is a low-stakes friend pool; the server enforces it as a shared secret. Don't "fix" by removing it without coordinating with the Apps Script.
- The 4-digit PIN is sent in the clear via JSONP query string. Same context — acceptable for this app.
- Series dedup in `loadState()` sorts team abbrevs to build the key — required because ESPN sometimes returns `(A,B)` and `(B,A)` for the same matchup.
