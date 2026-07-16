// Optional ADS-B adapter (gated by ENABLE_ADSB, default off — plan decision
// D3). Maps a dump1090/tar1090-style `aircraft.json` payload
// (`{ aircraft: [...] }`) to canonical Entity[] with type 'aircraft'.
// Source units: altitude in feet, ground speed in knots, vertical rate in
// feet/minute — converted to the canonical metric units.
import type { Entity } from 'shared/entity';

/** One record from a dump1090/tar1090 `aircraft.json` `aircraft[]` array (subset used). */
interface AdsbAircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  baro_rate?: number;
}

interface AdsbPayload {
  now?: number;
  aircraft: AdsbAircraft[];
}

const FEET_TO_METERS = 0.3048;
const KNOTS_TO_MS = 0.514444;
const FPM_TO_MS = FEET_TO_METERS / 60;
const ID_PREFIX = 'adsb-';

function isAdsbAircraft(value: unknown): value is AdsbAircraft {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.hex === 'string' &&
    typeof r.lat === 'number' &&
    typeof r.lon === 'number'
  );
}

function isAdsbPayload(value: unknown): value is AdsbPayload {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return Array.isArray(r.aircraft);
}

/**
 * Pure mapping: raw ADS-B `aircraft.json` payload -> canonical Entity[].
 * Skips aircraft without a lat/lon fix (not yet positioned) or reporting
 * 'ground' baro altitude ambiguity is treated as 0m (on the ground).
 */
export function mapAdsbAircraft(json: unknown, now: number = Date.now()): Entity[] {
  if (!isAdsbPayload(json)) return [];

  const ts = typeof json.now === 'number' ? Math.round(json.now * 1000) : now;
  const entities: Entity[] = [];

  for (const raw of json.aircraft) {
    if (!isAdsbAircraft(raw)) continue;
    if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') continue;

    const altFt = raw.alt_baro === 'ground' ? 0 : (raw.alt_baro ?? 0);

    // Motion travels as meta now (not required core fields), converted to the
    // canonical metric units. Callsign (`flight`) is the display name when the
    // aircraft is broadcasting one, otherwise fall back to the ICAO hex.
    const name = typeof raw.flight === 'string' && raw.flight.trim() ? raw.flight.trim() : raw.hex;
    const meta: Record<string, number> = {};
    if (Number.isFinite(raw.track)) meta.heading = ((raw.track as number) % 360 + 360) % 360;
    if (Number.isFinite(raw.gs)) meta.speed_ms = Math.max(0, (raw.gs as number) * KNOTS_TO_MS);
    if (Number.isFinite(raw.baro_rate)) meta.climb_ms = (raw.baro_rate as number) * FPM_TO_MS;

    const entity: Entity = {
      id: `${ID_PREFIX}${raw.hex}`,
      name,
      type: 'aircraft',
      lat: raw.lat,
      lon: raw.lon,
      altitude_m: altFt * FEET_TO_METERS,
      ts,
    };
    if (Object.keys(meta).length > 0) entity.meta = meta;
    entities.push(entity);
  }

  return entities;
}
