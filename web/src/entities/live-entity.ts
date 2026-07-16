// Maps the wire `Entity` (shared, SI, minimal) onto the richer `HudEntity`
// view-model the renderers already know how to draw (`e.trail`-based rendering).
// Motion (heading/speed/climb) now arrives as free-form `meta`, so the
// well-known numeric keys are read out of `meta` here into the typed sample.
import type { Entity, EntityMeta, EntityType } from 'shared';
import type { HudEntity, EntityKind, EntitySample } from './entity-types.js';
import { COLORS } from './entity-engine.js';

const MAX_TRAIL_POINTS = 300;

/** Read a numeric meta value (heading/speed_ms/…); `fallback` when absent/non-numeric. */
export function metaNumber(meta: EntityMeta | undefined, key: string, fallback = 0): number {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function wireTypeToKind(type: EntityType): EntityKind {
  if (type === 'chaser') return 'vehicle'; // chaser never renders via this path (handled as engine.chaser)
  return type;
}

function glyphFor(kind: EntityKind): string {
  if (kind === 'aircraft') return '▲'; // ▲
  if (kind === 'vehicle') return '▮'; // ▮
  return '◉'; // ◉ balloon/radiosonde
}

function classLabelFor(kind: EntityKind): string {
  if (kind === 'aircraft') return 'AIRCRAFT / ADS-B';
  if (kind === 'vehicle') return 'GROUND VEHICLE';
  return 'RADIOSONDE';
}

function sampleFrom(e: Entity): EntitySample {
  return {
    lat: e.lat,
    lon: e.lon,
    alt_m: e.altitude_m,
    vv: metaNumber(e.meta, 'climb_ms'),
    vh: metaNumber(e.meta, 'speed_ms'),
    hdg: metaNumber(e.meta, 'heading'),
    sats: metaNumber(e.meta, 'sats'),
    batt: metaNumber(e.meta, 'batt'),
    frame: 0,
    t: new Date(e.ts).toISOString(),
  };
}

/** Optional freq (MHz) pulled from a well-known meta key; null when absent. */
function freqFrom(meta: EntityMeta | undefined): number | null {
  const v = meta?.['freq_mhz'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Optional manufacturer/model label from a well-known meta key; '—' when absent. */
function mfrFrom(meta: EntityMeta | undefined): string {
  const v = meta?.['mfr'];
  return typeof v === 'string' && v ? v : '—';
}

/** Build a fresh HudEntity for a live wire entity seen for the first time. */
export function createLiveHudEntity(e: Entity): HudEntity {
  const kind = wireTypeToKind(e.type);
  return {
    id: e.id,
    name: e.name,
    kind,
    source: 'live',
    type: 'LIVE',
    mfr: mfrFrom(e.meta),
    freq: freqFrom(e.meta),
    classLabel: classLabelFor(kind),
    color: COLORS[kind] ?? COLORS.vehicle!,
    glyph: glyphFor(kind),
    status: 'ok',
    inZone: false,
    cur: sampleFrom(e),
    meta: e.meta,
    lat: e.lat,
    lon: e.lon,
    alt_m: e.altitude_m,
    hdg: metaNumber(e.meta, 'heading'),
    spd: metaNumber(e.meta, 'speed_ms'),
    vv: metaNumber(e.meta, 'climb_ms'),
    vh: metaNumber(e.meta, 'speed_ms'),
    sats: metaNumber(e.meta, 'sats'),
    batt: metaNumber(e.meta, 'batt'),
    trail: [[e.lat, e.lon]],
    frame: 0,
  };
}

/** Mutate an existing live HudEntity in place with a fresh wire sample. */
export function applyLiveSample(hud: HudEntity, e: Entity): void {
  hud.name = e.name;
  hud.lat = e.lat;
  hud.lon = e.lon;
  hud.alt_m = e.altitude_m;
  hud.hdg = metaNumber(e.meta, 'heading');
  hud.spd = metaNumber(e.meta, 'speed_ms');
  hud.vv = metaNumber(e.meta, 'climb_ms');
  hud.vh = metaNumber(e.meta, 'speed_ms');
  hud.mfr = mfrFrom(e.meta);
  hud.freq = freqFrom(e.meta);
  hud.cur = sampleFrom(e);
  hud.meta = e.meta;
  hud.frame = (hud.frame ?? 0) + 1;
  hud.status = 'ok';
  const trail = hud.trail ?? (hud.trail = []);
  trail.push([e.lat, e.lon]);
  if (trail.length > MAX_TRAIL_POINTS) trail.shift();
}

/** Prepend hydrated history points (oldest-first) ahead of whatever trail exists so far. */
export function prependTrailHistory(hud: HudEntity, points: [number, number][]): void {
  const existing = hud.trail ?? [];
  hud.trail = [...points, ...existing].slice(-MAX_TRAIL_POINTS);
}
