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

### One-shot, bare metal — no Docker (recommended)

On a fresh Ubuntu/Debian VPS with your domain's DNS pointed at it and ports
80/443 open:

```bash
git clone <this-repo> lazymaphud && cd lazymaphud
sudo ./scripts/deploy-vps.sh hud.example.com
```

`scripts/deploy-vps.sh` installs Node 20 + pnpm + native Caddy (if missing),
builds the web bundle, writes `.env` (generating a strong `WEBHOOK_SECRET`),
installs a hardened **systemd** service `lazymaphud` that runs the Fastify
server (which also serves the built web + WebSocket hub on port 3000), and
points Caddy at `localhost:3000` for automatic Let's Encrypt TLS. Idempotent —
re-run to redeploy. Use `:80` as the domain for a local, no-TLS smoke test.

```bash
systemctl status lazymaphud          # service state
journalctl -u lazymaphud -f          # live logs
sudo ./scripts/deploy-vps.sh <dom>   # redeploy after a git pull / .env change
```

Then review the optional vars (`SONDEHUB_SERIALS` / `ENABLE_ADSB` /
`CORS_ORIGIN`) in `.env` and re-run if you change them.

### Alternative: Docker Compose

The repo also ships a `docker-compose.yml` + `Dockerfile` (app + Caddy). If
you prefer containers:

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
2. Build the web static bundle (`web/dist`, a single `index.html`) with Vite.
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

## Security posture — public, open-feed by design

This deployment is intended to be **public**: the map/WebSocket are readable
by anyone, and `POST /chaser` accepts unauthenticated position feeds from
anyone (the chaser device page can't hold the HMAC secret client-side).
That's an accepted design choice — anyone who finds the URL can watch the
map and inject `chaser` entities. The guards that remain in place:

- **`POST /webhook`** stays HMAC-gated (needs `WEBHOOK_SECRET`) — only signed
  sources can push non-chaser entities.
- **Per-IP rate limits** (webhook 20/s, chaser 5/s) + body-size caps (64KB /
  4KB) + meta caps bound abuse. The server sets `trustProxy: true`, so these
  apply per **real client IP** (via Caddy's `X-Forwarded-For`), not per proxy.
- **Bind to localhost.** The bare-metal deploy sets `HOST=127.0.0.1` so the
  app port isn't reachable directly (only via Caddy) — which also keeps
  `trustProxy` safe from `X-Forwarded-For` spoofing. (Under Docker the app is
  `expose`-only / unpublished, giving the same property.)

If you later want to lock down the open `/chaser` feed or the public map,
gate them at Caddy — e.g. `basicauth` for the whole site, or restrict
`/chaser` to a VPN IP range:

```caddyfile
handle /chaser {
    @untrusted not remote_ip 100.64.0.0/10   # e.g. Tailscale CGNAT range
    respond @untrusted 403
    reverse_proxy localhost:3000
}
```

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
