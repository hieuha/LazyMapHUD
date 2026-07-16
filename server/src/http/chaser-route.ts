// ============================================================================
// POST /chaser — OPEN endpoint, NO AUTH (plan decision D6, revises D4).
//
// The chaser device (phone/tablet running web/chase.html) cannot hold the
// webhook HMAC secret client-side, so this route accepts unauthenticated
// position updates and trusts network isolation instead (VPN/LAN only).
//
// >>> TRUSTED-NETWORK-ONLY. DO NOT EXPOSE PUBLICLY AS-IS. <<<
// Before any public/internet-facing deploy (Phase 7), gate this route with a
// device token, mTLS, or move it behind a VPN. Anyone who can reach this port
// can currently inject an arbitrary `type:'chaser'` entity. Flagged in the
// plan's Open Questions + Phase 7 risk assessment — revisit before shipping
// past a trusted LAN/VPN.
// ============================================================================
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EntitySchema, type Entity } from 'shared/entity';
import type { EntityStore } from '../store/entity-store.js';
import { RateLimiter } from './rate-limiter.js';

export interface ChaserRouteOptions {
  store: EntityStore;
  /** Max requests per IP per window (default 5/sec). */
  maxPerSecond?: number;
}

const BODY_LIMIT_BYTES = 4 * 1024; // generous for {id,lat,lon,alt,heading,speed,meta}
const DEFAULT_MAX_PER_SECOND = 5;
const RATE_WINDOW_MS = 1000;
const SWEEP_INTERVAL_MS = 60_000;

// Minimal chaser payload — only id + lat/lon are required; everything else
// defaults so a bare GPS fix is enough to drive the map. The device still
// sends flat motion fields (heading/speed_ms); they're folded into `meta` to
// match the canonical contract (motion is metadata, not a core field).
const ChaserPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude_m: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed_ms: z.number().min(0).optional(),
  meta: EntitySchema.shape.meta,
});

function toEntity(payload: z.infer<typeof ChaserPayloadSchema>): unknown {
  const meta: Record<string, string | number | boolean> = { ...(payload.meta ?? {}) };
  if (payload.heading !== undefined) meta.heading = payload.heading;
  if (payload.speed_ms !== undefined) meta.speed_ms = payload.speed_ms;

  return {
    id: payload.id,
    name: payload.name ?? payload.id,
    type: 'chaser',
    lat: payload.lat,
    lon: payload.lon,
    altitude_m: payload.altitude_m ?? 0,
    ts: Date.now(),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

export function registerChaserRoute(app: FastifyInstance, options: ChaserRouteOptions): void {
  const { store } = options;
  const limiter = new RateLimiter(options.maxPerSecond ?? DEFAULT_MAX_PER_SECOND, RATE_WINDOW_MS);
  const sweepTimer = setInterval(() => limiter.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  app.addHook('onClose', (_instance, done) => {
    clearInterval(sweepTimer);
    done();
  });

  app.post(
    '/chaser',
    { bodyLimit: BODY_LIMIT_BYTES },
    async (req: FastifyRequest, reply) => {
      const ip = req.ip;
      if (!limiter.allow(ip)) {
        return reply.code(429).send({ error: 'rate_limited', message: 'too many requests' });
      }

      const parsed = ChaserPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'invalid chaser payload',
          issues: parsed.error.issues,
        });
      }

      const candidate = toEntity(parsed.data);
      const result = EntitySchema.safeParse(candidate);
      if (!result.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'invalid entity payload',
          issues: result.error.issues,
        });
      }

      const entity: Entity = result.data;
      store.upsert(entity);
      return reply.code(200).send({ ok: true, id: entity.id });
    },
  );
}
