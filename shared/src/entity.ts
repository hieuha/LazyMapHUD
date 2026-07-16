// Canonical Entity contract — the single source of truth for tracked objects
// (balloons, aircraft, vehicles, chasers) shared by server and web.
//
// The contract is deliberately minimal: only a handful of fields are required
// to put a tracked object on the map. Everything else — motion (heading,
// speed, climb), callsign, frequency, battery, whatever a source wants to
// attach — travels as free-form `meta` and is rendered flexibly by the HUD.
import { z } from 'zod';

export type EntityType = 'balloon' | 'aircraft' | 'vehicle' | 'chaser';

export const ENTITY_TYPES: readonly EntityType[] = [
  'balloon',
  'aircraft',
  'vehicle',
  'chaser',
] as const;

/** Arbitrary caller-supplied key/value metadata — e.g. heading, speed_ms, callsign, freq_mhz. */
export type EntityMeta = Record<string, string | number | boolean>;

/** Caps bounding stored/broadcast meta size — enforced once, at the schema. */
export const META_MAX_KEYS = 64;
export const META_MAX_BYTES = 4096;

/**
 * Canonical, fully-normalized entity — what the store holds and the WebSocket
 * hub broadcasts. `id` and `ts` are always present here (the server fills them
 * from `name` / receive-time when a caller omits them on the wire — see
 * `normalizeToEntity`).
 */
export interface Entity {
  /** stable correlation key across updates; defaults to `name` when a caller omits it. */
  id: string;
  /** required human-readable display name. */
  name: string;
  type: EntityType;
  lat: number;
  lon: number;
  altitude_m: number;
  /** epoch ms, source time (server-receive time when the caller omits it). */
  ts: number;
  /** everything beyond the required core — motion, callsign, freq, etc. Capped at META_MAX_KEYS / META_MAX_BYTES. */
  meta?: EntityMeta;
}

// Runtime validator for the canonical Entity. Keep in sync by hand with the
// interface above — zod's static inference is intentionally not used as the
// canonical type so the plain `Entity` interface stays the readable contract.
const EntityMetaSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .refine((meta) => Object.keys(meta).length <= META_MAX_KEYS, {
    message: `meta must have at most ${META_MAX_KEYS} keys`,
  })
  .refine((meta) => new TextEncoder().encode(JSON.stringify(meta)).length <= META_MAX_BYTES, {
    message: `meta must serialize to at most ${META_MAX_BYTES} bytes`,
  });

export const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['balloon', 'aircraft', 'vehicle', 'chaser']),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude_m: z.number(),
  ts: z.number().int().positive(),
  meta: EntityMetaSchema.optional(),
}) satisfies z.ZodType<Entity>;

// Core keys that live as first-class Entity fields — everything else in an
// incoming payload is folded into `meta`. `source` is excluded too: it's the
// adapter-routing selector (query/body), not tracked data.
const CORE_KEYS = new Set(['id', 'name', 'type', 'lat', 'lon', 'altitude_m', 'ts', 'meta', 'source']);

// Keys that could pollute the prototype chain — never copied into meta (the
// webhook is a public, open-feed endpoint; this is cheap defense-in-depth).
const UNSAFE_META_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Collect a raw payload's non-core scalar fields into an EntityMeta bag,
 * merged over an explicit `meta` object when the caller also sent one.
 * Non-scalar extras (nested objects/arrays) are dropped — meta holds scalars
 * only. Returns undefined when nothing survives (keeps stored rows clean).
 */
export function collectMeta(
  record: Record<string, unknown>,
  explicit?: EntityMeta,
): EntityMeta | undefined {
  const meta: EntityMeta = { ...(explicit ?? {}) };
  for (const [key, value] of Object.entries(record)) {
    if (CORE_KEYS.has(key) || UNSAFE_META_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value;
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Normalize a raw webhook payload into a canonical Entity-shaped object
 * (still unvalidated — the caller validates with EntitySchema): fill `id` from
 * `name` and `ts` from `now` when omitted, and auto-bucket every non-core
 * field into `meta`. Passes typed values straight through so EntitySchema does
 * the actual type/range checking. Non-object input is returned untouched so
 * the schema rejects it with a clear error.
 */
export function normalizeToEntity(body: unknown, now: number): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }
  const record = body as Record<string, unknown>;
  const explicitMeta =
    typeof record.meta === 'object' && record.meta !== null && !Array.isArray(record.meta)
      ? (record.meta as EntityMeta)
      : undefined;

  const candidate: Record<string, unknown> = {
    id: record.id ?? record.name,
    name: record.name,
    type: record.type,
    lat: record.lat,
    lon: record.lon,
    altitude_m: record.altitude_m,
    ts: record.ts ?? now,
  };
  const meta = collectMeta(record, explicitMeta);
  if (meta) candidate.meta = meta;
  return candidate;
}
