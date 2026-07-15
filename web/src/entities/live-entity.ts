// Maps the wire `Entity` (shared, SI, minimal) onto the richer `HudEntity`
// view-model the renderers already know how to draw (`e.trail`-based rendering).
import type { Entity, EntityType } from 'shared';
import type { HudEntity, EntityKind, EntitySample } from './entity-types.js';
import { COLORS } from './entity-engine.js';

const MAX_TRAIL_POINTS = 300;

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
    vv: e.climb_ms,
    vh: e.speed_ms,
    hdg: e.heading,
    sats: 0,
    batt: 0,
    frame: 0,
    t: new Date(e.ts).toISOString(),
  };
}

/** Build a fresh HudEntity for a live wire entity seen for the first time. */
export function createLiveHudEntity(e: Entity): HudEntity {
  const kind = wireTypeToKind(e.type);
  return {
    id: e.id,
    kind,
    source: 'live',
    type: 'LIVE',
    mfr: '—',
    freq: null,
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
    hdg: e.heading,
    spd: e.speed_ms,
    vv: e.climb_ms,
    vh: e.speed_ms,
    sats: 0,
    batt: 0,
    trail: [[e.lat, e.lon]],
    frame: 0,
  };
}

/** Mutate an existing live HudEntity in place with a fresh wire sample. */
export function applyLiveSample(hud: HudEntity, e: Entity): void {
  hud.lat = e.lat;
  hud.lon = e.lon;
  hud.alt_m = e.altitude_m;
  hud.hdg = e.heading;
  hud.spd = e.speed_ms;
  hud.vv = e.climb_ms;
  hud.vh = e.speed_ms;
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
