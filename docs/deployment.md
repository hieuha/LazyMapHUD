# Deployment Guide

Target topology (plan decision D2): a single VPS running Docker Compose —
one `app` container (Fastify server, serving the built web static files +
the WebSocket hub + the HTTP API) behind a `caddy` container (auto-TLS,
reverse proxy, `wss://` upgrade). The entity snapshot + trail history are
held in memory only — no database, no data volume, so nothing to back up
(state resets on restart/redeploy).

```
Internet --443/tcp,udp--> [caddy] --3000/tcp (internal)--> [app]
                                                              |
                                                    in-memory store
                                                    (no volume; resets on restart)
```

## Prerequisites

- A VPS (any provider) with Docker + Docker Compose v2 installed.
- A domain name pointed at the VPS's IP (A/AAAA record) — required for
  Caddy's automatic Let's Encrypt TLS. A bare-IP/no-DNS deploy is possible
  for testing (see "Local / no-TLS smoke test" below) but not recommended
  for anything real, since `/webhook` and `/chaser` should run over HTTPS.
- Ports 80 and 443 (tcp) + 443 (udp, for HTTP/3) open on the VPS firewall.

## First deploy

```bash
git clone <this-repo> lazymaphud && cd lazymaphud
cp .env.example .env
# Edit .env: set WEBHOOK_SECRET (long random string) and LAZYMAPHUD_DOMAIN
# (your real domain). Review SONDEHUB_SERIALS / ENABLE_ADSB / CORS_ORIGIN
# per docs/webhook-contract.md and the env table in README.md.

docker compose up -d --build
docker compose ps         # both `app` and `caddy` should show healthy/running
curl https://your-domain/healthz   # {"ok":true}
```

Caddy issues the TLS certificate automatically on first request to your
domain (may take a few seconds). `docker compose logs -f caddy` shows
certificate issuance progress if it's slow.

## What's in the image

The `Dockerfile` is a multi-stage build:
1. Install all pnpm workspace deps.
2. Build the web static bundle (`web/dist`, both `index.html` and
   `chase.html`) with Vite.
3. Runtime stage: production-only deps for `server` (+ its `shared`
   workspace dependency), the server source (run via `tsx`, matching this
   repo's TS-source-first convention — no separate compiled-JS step), and
   the built web static files, served by Fastify (`SERVE_STATIC=true`).

No secrets are baked into the image — `WEBHOOK_SECRET` and everything else
in the env table are supplied at `docker run`/`docker compose up` time via
the `.env` file, which `docker compose` loads automatically and which
`.gitignore` and `.dockerignore` both exclude from version control and the
build context.

## Data persistence — none (in-memory store)

There is no database and no data volume. The live entity snapshot and trail
history live entirely in the `app` process's memory, bounded by
`HISTORY_RETENTION` (default `7d`). Nothing to back up or restore.

**Consequence:** any restart, image rebuild, or `docker compose up --build`
starts with an empty map. Entities reappear as soon as live data arrives
(a `/webhook` push, a configured SondeHub/ADS-B poller, or a `/chaser`
device), and WS clients reconnect automatically (frontend has built-in
reconnect/backoff). Past trails from before the restart are not recoverable.

If durable history ever becomes a requirement, reintroduce a persistent
store behind the existing `HistoryRepo` interface (`server/src/store/history-repo.ts`)
— the rest of the server is written against that interface and would not change.

## Gating `/chaser` before public exposure

`POST /chaser` is intentionally unauthenticated (see
`docs/webhook-contract.md`) — the chaser device page can't hold the webhook
HMAC secret client-side. **This is safe only on a trusted network.** Before
exposing this deployment on the open internet, pick one:

1. **VPN-only chaser path.** Keep the chaser device on a Tailscale/WireGuard
   VPN that reaches the VPS privately, and block `/chaser` at Caddy for
   any request not coming from the VPN's IP range:
   ```caddyfile
   handle /chaser {
       @not_trusted not remote_ip 100.64.0.0/10   # example: Tailscale CGNAT range
       respond @not_trusted 403
       reverse_proxy app:3000
   }
   ```
2. **Device token.** Add a shared-secret query param or header the chase.html
   page includes on every POST, checked in `chaser-route.ts` before the rate
   limiter — the simplest code change if VPN isn't an option; not yet
   implemented in this codebase (tracked as a pre-public-launch follow-up,
   not blocking the initial trusted-network/staging deploy this phase ships).
3. **mTLS at Caddy** for the `/chaser` path specifically, issuing a client
   cert to the chaser device — most robust, more setup.

Until one of these is in place, treat any public deployment's `/chaser`
endpoint as **write-open to anyone who finds the URL** — they can inject
fake `chaser` entities onto the map. `/webhook` is not affected (HMAC-gated
regardless of network).

## CORS

Same-origin by default (unset `CORS_ORIGIN`) — the standard Caddy/D2 deploy
serves the web build and the API from the same domain, so no CORS headers
are needed at all. Only set `CORS_ORIGIN` (comma-separated origins, or `*`)
if you serve the web build from a different origin than this API (e.g. a
separate static host/CDN) — see the env table in `README.md`.

## Local / no-TLS smoke test

To validate the full compose stack locally without a real domain:

```bash
WEBHOOK_SECRET=local-test-secret LAZYMAPHUD_DOMAIN=:80 docker compose up -d --build
curl http://localhost/healthz
docker compose down -v
```

`LAZYMAPHUD_DOMAIN=:80` tells Caddy to serve plain HTTP on port 80 with no
TLS — Caddy skips certificate issuance for a bare port address. Do not use
this form for a real deployment.

## Updating a running deployment

```bash
git pull
docker compose up -d --build   # rebuilds the app image, restarts app only
                                 # (caddy config/volumes are untouched)
```

The healthcheck (`/healthz`, `HEALTHCHECK` in the Dockerfile +
`healthcheck:` in compose) gates Caddy's `depends_on: condition:
service_healthy`, so Caddy won't route traffic to a not-yet-ready `app`
container after a redeploy.

## Tiles — fair-use note

The HUD's basemaps use public, fair-use tile providers (OpenStreetMap-style)
at launch. These have usage limits (rate limits, no bulk/commercial reuse
without a paid plan) — acceptable for a single-operator/small-crew tracking
tool, but if traffic grows (many concurrent viewers, embedded in a
higher-traffic page), either switch to a paid tile provider or stand up a
caching tile-proxy in front of the public providers. A caching tile-proxy
route was scoped as a stretch item for this phase and was **not built** —
revisit if tile-provider rate limiting becomes a real problem in practice.
HighSight stays a disabled placeholder until a real tile source is
supplied.
