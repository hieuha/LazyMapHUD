// Fastify boot — process startup, health check, the in-memory entity store +
// webhook/history HTTP routes (Phase 2), and the WebSocket broadcast hub
// (Phase 3, server->browser only — see plan decision D4).
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { HistoryRepo } from './store/history-repo.js';
import { EntityStore } from './store/entity-store.js';
import { registerWebhookRoute } from './http/webhook-route.js';
import { registerHistoryRoute } from './http/history-route.js';
import { registerChaserRoute } from './http/chaser-route.js';
import { parseDurationMs } from './util/parse-duration.js';
import { WsHub } from './ws/hub.js';
import { startPoller, type Poller } from './adapters/poller.js';
import { fetchLatest as fetchSondehubLatest } from './adapters/sondehub.js';
import { mapAdsbAircraft } from './adapters/adsb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
// Trail history + entity snapshot are in-memory only (no durable store).
// HISTORY_RETENTION bounds how far back the in-memory trail is kept.
const HISTORY_RETENTION_MS = parseDurationMs(process.env.HISTORY_RETENTION ?? '7d');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WS_PATH = process.env.WS_PATH ?? '/ws';
// Listen host. Default 0.0.0.0 (Docker: the app is only reachable on the
// internal compose network). On a bare-metal deploy set HOST=127.0.0.1 so the
// port isn't exposed to the internet directly — only the local Caddy proxy
// reaches it (which also keeps trustProxy safe from X-Forwarded-For spoofing).
const HOST = process.env.HOST ?? '0.0.0.0';
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly

// CORS (Phase 7 hardening): off/same-origin by default. Set CORS_ORIGIN to a
// comma-separated list of allowed origins (or "*") to enable cross-origin
// access to /history, /webhook, /chaser — needed when the web build is
// served from a different origin than the API (e.g. a CDN in front of the
// static files). The single-container/Caddy same-origin deploy (D2) doesn't
// need this at all.
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '';

// Static serving (Phase 7): serve the built web/dist (index.html + chase.html)
// straight from Fastify so a single container can run web + API + WS behind
// Caddy without a separate static file server. Off by default so `pnpm dev`
// (Vite dev server) and tests are unaffected.
const SERVE_STATIC = process.env.SERVE_STATIC === 'true';
const STATIC_ROOT = process.env.STATIC_ROOT ?? join(__dirname, '../../web/dist');

// SondeHub poller config — default empty (no serials) so boot stays a clean
// empty map (plan decision D7); set SONDEHUB_SERIALS to a comma-separated
// list (e.g. "Y0322352,Y0322353") to enable.
const SONDEHUB_SERIALS = (process.env.SONDEHUB_SERIALS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SONDEHUB_POLL_MS = Number(process.env.SONDEHUB_POLL_MS ?? 15_000);

// ADS-B poller config — optional adapter, off by default (plan decision D3).
// Requires both the flag and a reachable aircraft.json URL (e.g. a local
// dump1090/tar1090 instance) to actually start polling.
const ENABLE_ADSB = process.env.ENABLE_ADSB === 'true';
const ADSB_URL = process.env.ADSB_URL;
const ADSB_POLL_MS = Number(process.env.ADSB_POLL_MS ?? 5_000);

const app = Fastify({
  logger: true,
  // Behind the Caddy reverse proxy, use X-Forwarded-For as the client IP so
  // the per-IP rate limiter (the only abuse guard on the open endpoints) and
  // logs see the real client, not the proxy. Safe because the app is only
  // reachable via the proxy: bind HOST=127.0.0.1 on bare metal (see the deploy
  // script), and it's `expose`-only (unpublished) under Docker.
  trustProxy: true,
});

const repo = new HistoryRepo();
const store = new EntityStore(repo);

app.get('/healthz', async () => {
  return { ok: true };
});

if (WEBHOOK_SECRET) {
  registerWebhookRoute(app, { store, webhookSecret: WEBHOOK_SECRET });
} else {
  app.log.warn('WEBHOOK_SECRET is not set — /webhook route disabled');
}

registerHistoryRoute(app, { repo });

// OPEN endpoint, no auth — trusted-network-only (D6). See chaser-route.ts
// header comment: gate with a token/VPN before any public deploy.
registerChaserRoute(app, { store });

/**
 * Register CORS (only if CORS_ORIGIN is set) and static file serving (only
 * if SERVE_STATIC=true). Both are Fastify plugins with async `register`, so
 * this must be awaited before `app.listen()`.
 */
async function registerOptionalPlugins(): Promise<void> {
  if (CORS_ORIGIN) {
    const origins = CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    await app.register(cors, {
      origin: origins.includes('*') ? true : origins,
    });
    app.log.info(`CORS enabled for origin(s): ${CORS_ORIGIN}`);
  }

  if (SERVE_STATIC) {
    await app.register(fastifyStatic, {
      root: STATIC_ROOT,
      // Cache policy that survives a CDN (Cloudflare) in front:
      // - Vite's content-hashed assets (/assets/*) are immutable → cache forever.
      // - index.html has a stable URL but points at the current hashes, so it
      //   must always revalidate (no-cache) or a stale HTML pins an old bundle.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // Only fall back to index.html for GET/HEAD navigations that didn't
      // match an existing static file or API route — keeps 404s honest for
      // API paths (e.g. POST /webhook typos) instead of masking them.
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/history') && !req.url.startsWith('/chaser')) {
        // Never let the SPA entry point get cached by a CDN/browser, else a
        // new deploy's clients keep loading the previous bundle's hashes.
        reply.header('Cache-Control', 'no-cache');
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
    app.log.info(`Serving static web build from ${STATIC_ROOT}`);
  }
}

let hub: WsHub | undefined;
let pruneTimer: NodeJS.Timeout | undefined;
const pollers: Poller[] = [];

/**
 * Start the SondeHub poller for each configured serial and, if enabled, the
 * ADS-B poller. No-ops when unconfigured — default boot has SONDEHUB_SERIALS
 * empty so no poller starts (plan decision D7: empty map by default).
 */
function startAdapterPollers(): void {
  for (const serial of SONDEHUB_SERIALS) {
    const poller = startPoller({
      intervalMs: SONDEHUB_POLL_MS,
      fetchFn: () => fetchSondehubLatest(serial),
      onEntities: (entities) => entities.forEach((e) => store.upsert(e)),
      logger: app.log,
      label: `sondehub:${serial}`,
    });
    pollers.push(poller);
    app.log.info(`SondeHub poller started for serial ${serial} (every ${SONDEHUB_POLL_MS}ms)`);
  }

  if (ENABLE_ADSB && ADSB_URL) {
    const poller = startPoller({
      intervalMs: ADSB_POLL_MS,
      fetchFn: async () => {
        const res = await fetch(ADSB_URL);
        if (!res.ok) throw new Error(`ADS-B fetch failed: ${res.status}`);
        return mapAdsbAircraft(await res.json());
      },
      onEntities: (entities) => entities.forEach((e) => store.upsert(e)),
      logger: app.log,
      label: 'adsb',
    });
    pollers.push(poller);
    app.log.info(`ADS-B poller started from ${ADSB_URL} (every ${ADSB_POLL_MS}ms)`);
  } else if (ENABLE_ADSB) {
    app.log.warn('ENABLE_ADSB is set but ADSB_URL is not — ADS-B poller not started');
  }
}

async function start(): Promise<void> {
  try {
    store.warmFromHistory();
    store.startSweep();
    pruneTimer = setInterval(() => repo.prune(HISTORY_RETENTION_MS), PRUNE_INTERVAL_MS);
    pruneTimer.unref();

    await registerOptionalPlugins();
    await app.listen({ port: PORT, host: HOST });

    hub = new WsHub({ store, server: app.server, path: WS_PATH });
    app.log.info(`WebSocket hub listening on ${WS_PATH}`);

    startAdapterPollers();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  for (const poller of pollers) poller.stop();
  store.stopSweep();
  if (pruneTimer) clearInterval(pruneTimer);
  if (hub) await hub.close();
  await app.close();
  repo.close();
}

process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));

start();
