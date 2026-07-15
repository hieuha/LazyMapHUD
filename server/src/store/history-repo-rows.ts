// Row shapes returned by better-sqlite3 for the `entities`/`track_points`
// tables, plus the meta JSON (de)serialization helpers (D5) — split out of
// history-repo.ts to keep that file focused on the repo class itself.
import type { EntityMeta, EntityType } from 'shared/entity';

export interface EntityRow {
  id: string;
  type: EntityType;
  lat: number;
  lon: number;
  altitude_m: number;
  heading: number;
  speed_ms: number;
  climb_ms: number;
  ts: number;
  /** JSON-serialized EntityMeta, or null when absent (D5). */
  meta: string | null;
}

export interface TrackPointRow {
  lat: number;
  lon: number;
  altitude_m: number;
  heading: number;
  speed_ms: number;
  climb_ms: number;
  ts: number;
}

/** Parse a stored meta JSON TEXT column back to EntityMeta; malformed/absent -> undefined. */
export function parseMeta(raw: string | null): EntityMeta | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as EntityMeta;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Serialize EntityMeta for storage; undefined/absent -> null (no column write noise). */
export function serializeMeta(meta: EntityMeta | undefined): string | null {
  return meta ? JSON.stringify(meta) : null;
}
