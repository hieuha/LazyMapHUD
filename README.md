# LazyMapHUD

Real-time tracking map HUD: entities (radiosonde balloons, aircraft,
vehicles, a chaser device) push position updates over a signed webhook; a
Node/Fastify service normalizes them (in-memory store, no database) and
broadcasts live deltas over WebSocket to a Vanilla JS + Vite/Leaflet
front-end with a tactical-ops HUD (follow-cam, altitude ladder, chaser
proximity alerts, unit/timezone toggles, multiple basemaps).

Reference feed: [SondeHub](https://sondehub.org) radiosonde telemetry.

## Stack

- **Server:** Node ≥20, Fastify, `ws` (WebSocket). In-memory store for the
  live entity snapshot + trail history (no database — state is lost on
  restart; deploy stays light with no native addon or data volume).
- **Web:** Vanilla TypeScript + Vite + Leaflet. Two static entry points:
  `index.html` (the HUD) and `chase.html` (the Chaser-mode device page).
- **Shared:** a `shared` workspace package — the canonical `Entity`/wire
  protocol contracts (Zod schemas + TS types), used by both server and web.
- **Monorepo:** pnpm workspaces (`shared/`, `server/`, `web/`).
- **Deploy:** Docker + Docker Compose + Caddy (auto-TLS reverse proxy),
  single VPS. See `docs/deployment.md`.

## Repository layout

```
shared/    canonical Entity + wire-protocol contracts (Zod + TS)
server/    Fastify: webhook/history/chaser routes, WS hub, in-memory store, SondeHub/ADS-B pollers
web/       Vite app: index.html (HUD) + chase.html (chaser device page)
docs/      webhook-contract.md, deployment.md
concepts/  the approved HTML mockup this HUD was built from (reference only)
```

## Prerequisites

- Node ≥20 (see `.nvmrc`)
- [pnpm](https://pnpm.io) 10.x (`corepack enable` picks up the version
  pinned in `package.json`'s `packageManager` field)
- Docker + Docker Compose v2, for the production deploy path (optional for
  local dev)

## Local development

```bash
pnpm install
cp .env.example .env   # fill in WEBHOOK_SECRET at minimum
pnpm dev                # runs server (tsx watch) + web (vite) concurrently
```

- Web dev server: http://localhost:5173 (Vite proxies `/history` and
  `/chaser` to the API at `http://localhost:3000` — see `web/vite.config.ts`;
  this keeps the browser same-origin in dev, matching the production
  same-origin topology behind Caddy).
- API/WS: http://localhost:3000, WebSocket at `ws://localhost:3000/ws`.
- Chaser device page (dev): http://localhost:5173/chase.html
- The map is **empty by default** — no simulated/demo data (plan decision
  D7). Feed it a real entity via `/webhook` (see below) or configure
  `SONDEHUB_SERIALS` to poll a live feed.

### Send a test entity

```bash
SECRET="your-webhook-secret"   # must match WEBHOOK_SECRET in your .env
BODY='{"id":"balloon-1","type":"balloon","lat":21.0285,"lon":105.8542,"altitude_m":1500,"heading":90,"speed_ms":5,"climb_ms":2,"ts":'"$(date +%s000)"'}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

Full webhook contract (payload schema, HMAC signing details, source
adapters for `sondehub`/`adsb` feeds, the `/chaser` device endpoint, and
`/history` trail queries): **[docs/webhook-contract.md](docs/webhook-contract.md)**.

## Build

```bash
pnpm -r typecheck   # shared + server + web
pnpm --filter server test
pnpm build           # builds web (Vite) + typechecks server (see note below)
```

`server`'s `build` script runs a strict typecheck (`tsc --noEmit`) rather
than emitting compiled JS — this workspace runs TypeScript directly via
`tsx` in both dev and production (`pnpm --filter server start`), so there's
no separate compile-to-JS step. `web`'s build (`vite build`) is the one
that actually produces static output, to `web/dist` (both `index.html` and
`chase.html` as separate entry points).

## Environment variables

All variables live in `.env.example` (copy to `.env`, never commit `.env`).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server HTTP/WS port |
| `WEBHOOK_SECRET` | _(none — route disabled if unset)_ | HMAC-SHA256 key for `POST /webhook`. **Required** to accept live data. |
| `WS_PATH` | `/ws` | WebSocket upgrade path |
| `HISTORY_RETENTION` | `7d` | How long in-memory track history is kept before pruning (`ms\|s\|m\|h\|d` shorthand or a bare ms integer) |
| `SONDEHUB_SERIALS` | _(empty)_ | Comma-separated SondeHub serials to poll (e.g. `Y0322352,Y0322353`); empty = no poller, map stays empty until fed |
| `SONDEHUB_POLL_MS` | `15000` | SondeHub poll interval per serial |
| `ENABLE_ADSB` | `false` | Enable the optional ADS-B poller (needs `ADSB_URL` too) |
| `ADSB_URL` | _(unset)_ | A local `aircraft.json` endpoint (e.g. dump1090/tar1090) |
| `ADSB_POLL_MS` | `5000` | ADS-B poll interval |
| `CORS_ORIGIN` | _(empty — same-origin only)_ | Comma-separated allowed origins (or `*`) for cross-origin `/history`, `/webhook`, `/chaser` access. Unneeded for the standard same-origin Caddy deploy. |
| `SERVE_STATIC` | `false` | When `true`, this Fastify server also serves the built `web/dist` (both HTML entries) — used by the single-container Docker deploy |
| `STATIC_ROOT` | `../web/dist` (relative to `server/`) | Override the directory served when `SERVE_STATIC=true` |
| `VITE_WS_URL` | `ws://localhost:3000/ws` | (web) WebSocket URL the HUD connects to |
| `VITE_API_URL` | _(unset — same-origin)_ | (web) API origin for `/history`/`/chaser`; only set if the API is on a different origin than the web build (and set `CORS_ORIGIN` to match) |
| `LAZYMAPHUD_DOMAIN` | _(required for `docker compose`)_ | Public domain Caddy issues a TLS cert for; use `:80` for a local no-TLS smoke test |

## Deploy

Production target: a single VPS running Docker Compose (`app` + `caddy`).
No database or data volume — the store is in-memory (state resets on
restart/redeploy). Full walkthrough and how to gate the open `/chaser`
endpoint before public exposure: **[docs/deployment.md](docs/deployment.md)**.

Quick start:

```bash
cp .env.example .env   # set WEBHOOK_SECRET + LAZYMAPHUD_DOMAIN
docker compose up -d --build
curl https://your-domain/healthz
```

## Tiles

Basemaps use public, fair-use tile providers at launch. These have rate
limits and disallow heavy/commercial reuse without a paid plan — fine for a
single-operator tracking tool, but revisit (paid provider, or a caching
tile-proxy) if traffic grows. See the "Tiles" section in
`docs/deployment.md`. HighSight is a disabled placeholder until a real tile
source is supplied.

## Security notes

- `POST /webhook` is HMAC-SHA256 signed (see `docs/webhook-contract.md`),
  body-capped at 64KB, and per-IP rate-limited (20 req/s) in addition to the
  signature check.
- `POST /chaser` is **intentionally unauthenticated** — the browser-based
  chaser device page can't hold the webhook secret. It's rate-limited
  (5 req/s/IP) and body-capped (4KB) but relies on network trust (VPN/LAN)
  for anything beyond casual abuse. **Gate it before exposing publicly** —
  see `docs/deployment.md`.
- No secrets are baked into the Docker image; all config is env-supplied at
  run time.
