// Canonical Entity contract — the single source of truth for tracked objects
// (balloons, aircraft, vehicles, chasers) shared by server and web.
import { z } from 'zod';

export type EntityType = 'balloon' | 'aircraft' | 'vehicle' | 'chaser';

export const ENTITY_TYPES: readonly EntityType[] = [
  'balloon',
  'aircraft',
  'vehicle',
  'chaser',
] as const;

/** Arbitrary caller-supplied key/value metadata (D5) — e.g. callsign, freq_mhz. */
export type EntityMeta = Record<string, string | number | boolean>;

/** Caps bounding stored/broadcast meta size — enforced once, at the schema. */
export const META_MAX_KEYS = 32;
export const META_MAX_BYTES = 2048;

export interface Entity {
  id: string;
  type: EntityType;
  lat: number;
  lon: number;
  altitude_m: number;
  /** degrees, 0-360 */
  heading: number;
  /** ground speed, meters/second */
  speed_ms: number;
  /** vertical rate, meters/second (positive = ascending) */
  climb_ms: number;
  /** epoch ms, source time */
  ts: number;
  /** arbitrary caller metadata (D5), capped at META_MAX_KEYS keys / META_MAX_BYTES serialized. */
  meta?: EntityMeta;
}

// Runtime validator mirroring the Entity interface. Keep in sync by hand —
// zod's static inference (z.infer<typeof EntitySchema>) is intentionally not
// used as the canonical type so the plain `Entity` interface stays the
// readable, dependency-free contract referenced across the codebase.
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
  type: z.enum(['balloon', 'aircraft', 'vehicle', 'chaser']),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  altitude_m: z.number(),
  heading: z.number().min(0).max(360),
  speed_ms: z.number().min(0),
  climb_ms: z.number(),
  ts: z.number().int().positive(),
  meta: EntityMetaSchema.optional(),
}) satisfies z.ZodType<Entity>;
