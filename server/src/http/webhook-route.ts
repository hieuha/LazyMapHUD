// POST /webhook — HMAC-authed entity ingest. Verifies X-Signature over the
// RAW request body (captured via a custom content-type parser so the parsed
// JSON re-serialization never affects the signature check), resolves a
// source adapter, validates against the shared EntitySchema, and upserts.
//
// Hardening (Phase 7): HMAC stays the primary gate (a request with a bad/
// missing signature never reaches business logic), but a body-size cap and
// a per-IP rate limit sit in front of it too, so an attacker who doesn't
// know the secret still can't use this route to exhaust memory/CPU with
// oversized or high-frequency requests.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EntitySchema } from 'shared/entity';
import type { EntityStore } from '../store/entity-store.js';
import { verifyHmac } from '../ingest/hmac.js';
import { resolveAdapter } from '../ingest/adapter-registry.js';
import { RateLimiter } from './rate-limiter.js';

// Augment FastifyRequest with the raw body captured by the content-type
// parser below (module-local convention; only this route relies on it).
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export interface WebhookRouteOptions {
  store: EntityStore;
  webhookSecret: string;
  /** Max requests per IP per window (default 20/sec — signed traffic, higher than /chaser). */
  maxPerSecond?: number;
}

const BODY_LIMIT_BYTES = 64 * 1024; // 64KB — generous for an entity + meta payload
const DEFAULT_MAX_PER_SECOND = 20;
const RATE_WINDOW_MS = 1000;
const SWEEP_INTERVAL_MS = 60_000;

export function registerWebhookRoute(app: FastifyInstance, options: WebhookRouteOptions): void {
  const { store, webhookSecret } = options;
  const limiter = new RateLimiter(options.maxPerSecond ?? DEFAULT_MAX_PER_SECOND, RATE_WINDOW_MS);
  const sweepTimer = setInterval(() => limiter.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  app.addHook('onClose', (_instance, done) => {
    clearInterval(sweepTimer);
    done();
  });

  // Capture the raw bytes before JSON parsing so HMAC verification is exact.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      req.rawBody = body;
      try {
        const json = body.length === 0 ? {} : JSON.parse(body.toString('utf8'));
        done(null, json);
      } catch {
        // Defer the parse error to the route handler as a 400, not a
        // Fastify-level parser error, so the response shape stays consistent.
        done(null, undefined);
      }
    },
  );

  app.post('/webhook', { bodyLimit: BODY_LIMIT_BYTES }, async (req, reply) => {
    if (!limiter.allow(req.ip)) {
      return reply.code(429).send({ error: 'rate_limited', message: 'too many requests' });
    }

    const signature = req.headers['x-signature'];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

    if (!req.rawBody || !verifyHmac(req.rawBody, signatureHeader, webhookSecret)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'missing or invalid X-Signature' });
    }

    if (req.body === undefined) {
      return reply.code(400).send({ error: 'bad_request', message: 'malformed JSON body' });
    }

    const query = req.query as Record<string, unknown>;
    const bodyRecord =
      typeof req.body === 'object' && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
    const source =
      (typeof query.source === 'string' && query.source) ||
      (typeof bodyRecord.source === 'string' && bodyRecord.source) ||
      undefined;

    const adapter = resolveAdapter(source);
    const candidate = adapter.toEntity(req.body);

    const result = EntitySchema.safeParse(candidate);
    if (!result.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'invalid entity payload',
        issues: result.error.issues,
      });
    }

    store.upsert(result.data);
    return reply.code(200).send({ ok: true, id: result.data.id });
  });
}
