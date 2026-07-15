// SondeHub radiosonde adapter: fetch latest telemetry for a serial and map
// the provider's frame shape to the canonical Entity. The API redirects
// (302) to a flat S3 JSON array of frames — see
// https://api.v2.sondehub.org/sonde/{serial}. Frames are keyed by `frame`
// (a monotonically increasing packet counter); multiple receivers can
// re-upload the same frame, so we dedupe and keep the latest per serial.
import type { Entity } from 'shared/entity';

/** Raw per-frame record as returned by the SondeHub v2 API (subset of fields we use). */
interface SondehubFrame {
  serial: string;
  datetime: string;
  lat: number;
  lon: number;
  alt: number;
  vel_v: number;
  vel_h: number;
  heading: number;
  frame: number;
  type?: string;
}

/** Reject frames whose source `ts` is further than this into the future (clock skew tolerance). */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const ID_PREFIX = 'sonde-';

function isSondehubFrame(value: unknown): value is SondehubFrame {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.serial === 'string' &&
    typeof r.datetime === 'string' &&
    typeof r.lat === 'number' &&
    typeof r.lon === 'number' &&
    typeof r.alt === 'number' &&
    typeof r.frame === 'number'
  );
}

/** Map a single raw frame to a canonical Entity, or undefined if unmappable/out-of-range. */
function mapFrame(frame: SondehubFrame, now: number): Entity | undefined {
  const ts = Date.parse(frame.datetime);
  if (!Number.isFinite(ts) || ts > now + MAX_FUTURE_SKEW_MS) {
    return undefined;
  }
  if (!Number.isFinite(frame.lat) || !Number.isFinite(frame.lon) || !Number.isFinite(frame.alt)) {
    return undefined;
  }

  return {
    id: `${ID_PREFIX}${frame.serial}`,
    type: 'balloon',
    lat: frame.lat,
    lon: frame.lon,
    altitude_m: frame.alt,
    heading: Number.isFinite(frame.heading) ? ((frame.heading % 360) + 360) % 360 : 0,
    speed_ms: Number.isFinite(frame.vel_h) ? Math.max(0, frame.vel_h) : 0,
    climb_ms: Number.isFinite(frame.vel_v) ? frame.vel_v : 0,
    ts,
  };
}

/**
 * Pure mapping: raw SondeHub API JSON (array of frames, possibly mixed
 * serials/partial due to a truncated fetch) -> canonical Entity[], deduped
 * by `frame` per serial, keeping the frame with the latest `ts`. Tolerant of
 * malformed/partial entries (skips them) so a truncated body salvages
 * whatever complete records it contains.
 */
export function mapSondehubFrames(json: unknown, now: number = Date.now()): Entity[] {
  if (!Array.isArray(json)) return [];

  // Keyed by `${serial}:${frame}` so latest-wins dedupe is per (serial, frame).
  const bestByFrameKey = new Map<string, Entity>();

  for (const raw of json) {
    if (!isSondehubFrame(raw)) continue;
    const entity = mapFrame(raw, now);
    if (!entity) continue;

    const frameKey = `${raw.serial}:${raw.frame}`;
    const existing = bestByFrameKey.get(frameKey);
    if (!existing || entity.ts >= existing.ts) {
      bestByFrameKey.set(frameKey, entity);
    }
  }

  // Reduce to the single latest entity per serial (across all its frames).
  const latestBySerial = new Map<string, Entity>();
  for (const entity of bestByFrameKey.values()) {
    const current = latestBySerial.get(entity.id);
    if (!current || entity.ts > current.ts) {
      latestBySerial.set(entity.id, entity);
    }
  }

  return [...latestBySerial.values()];
}

/**
 * Fetch latest telemetry for a serial from the SondeHub v2 API, following
 * the 302 -> S3 redirect (handled transparently by `fetch`), and return the
 * mapped latest Entity (or undefined if the serial has no valid frames —
 * e.g. it hasn't flown recently, or the response was empty/unparseable).
 *
 * Tolerates a truncated/partial JSON body (observed in practice on large
 * flights) by salvaging the last complete top-level array element instead
 * of failing the whole fetch.
 */
export async function fetchLatest(serial: string): Promise<Entity | undefined> {
  const url = `https://api.v2.sondehub.org/sonde/${encodeURIComponent(serial)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let text: string;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const json = parseTolerant(text);
  const entities = mapSondehubFrames(json);
  return entities.find((e) => e.id === `${ID_PREFIX}${serial}`);
}

/**
 * Parse a JSON array body, tolerating truncation mid-stream: if the full
 * parse fails, salvage by trimming back to the last complete `},{` / `}]`
 * boundary and retrying. Returns `[]` if nothing salvageable.
 */
function parseTolerant(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const lastComplete = text.lastIndexOf('},');
    if (lastComplete === -1) return [];
    const salvaged = `${text.slice(0, lastComplete + 1)}]`;
    try {
      return JSON.parse(salvaged);
    } catch {
      return [];
    }
  }
}
