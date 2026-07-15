// SI unit conversions + geo math shared by server and web.
// Ported conceptually from concepts/concept-hybrid-tactical-ops.html: all raw
// entity values stay in SI (meters, m/s); these helpers only format/convert
// at the edges (display or distance checks), never mutate source data.

const M_TO_FT = 3.28084;
const MS_TO_KMH = 3.6;
const MS_TO_KNOTS = 1.94384;
const EARTH_RADIUS_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

/** meters -> feet */
export function metersToFeet(m: number): number {
  return m * M_TO_FT;
}

/** feet -> meters */
export function feetToMeters(ft: number): number {
  return ft / M_TO_FT;
}

/** m/s -> ft/min (vertical rate) */
export function msToFtPerMin(ms: number): number {
  return ms * M_TO_FT * 60;
}

/** ft/min -> m/s */
export function ftPerMinToMs(fpm: number): number {
  return fpm / M_TO_FT / 60;
}

/** m/s -> km/h (ground speed) */
export function msToKmh(ms: number): number {
  return ms * MS_TO_KMH;
}

/** km/h -> m/s */
export function kmhToMs(kmh: number): number {
  return kmh / MS_TO_KMH;
}

/** m/s -> knots */
export function msToKnots(ms: number): number {
  return ms * MS_TO_KNOTS;
}

/** knots -> m/s */
export function knotsToMs(knots: number): number {
  return knots / MS_TO_KNOTS;
}

/**
 * Great-circle horizontal distance between two lat/lon points, in meters.
 * Altitude is ignored (ground-track distance only).
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Format a coordinate in decimal degrees to a fixed precision (default 5 dp ~1.1m). */
export function formatCoord(deg: number, precision = 5): string {
  return deg.toFixed(precision);
}

/** Format latitude with N/S hemisphere suffix. */
export function formatLat(lat: number, precision = 5): string {
  return `${formatCoord(Math.abs(lat), precision)}°${lat >= 0 ? 'N' : 'S'}`;
}

/** Format longitude with E/W hemisphere suffix. */
export function formatLon(lon: number, precision = 5): string {
  return `${formatCoord(Math.abs(lon), precision)}°${lon >= 0 ? 'E' : 'W'}`;
}

export type UnitSystem = 'metric' | 'imperial';

/** Altitude: meters in -> formatted string ("1234 m" | "4048 ft"). */
export function formatAltitude(m: number, units: UnitSystem): string {
  if (units === 'imperial') return `${Math.round(metersToFeet(m)).toLocaleString('en-US')} ft`;
  return `${Math.round(m).toLocaleString('en-US')} m`;
}

/** Climb/vertical rate: m/s in -> signed formatted string. */
export function formatClimb(ms: number, units: UnitSystem): string {
  const sign = ms >= 0 ? '+' : '';
  if (units === 'imperial') {
    return `${sign}${Math.round(msToFtPerMin(ms)).toLocaleString('en-US')} ft/min`;
  }
  return `${sign}${ms.toFixed(1)} m/s`;
}

/** Ground speed: m/s in -> formatted string. */
export function formatSpeed(ms: number, units: UnitSystem): string {
  if (units === 'imperial') return `${msToKnots(ms).toFixed(0)} kt`;
  return `${msToKmh(ms).toFixed(0)} km/h`;
}

/** Distance: meters in -> formatted string (km or statute miles). */
export function formatDistance(m: number, units: UnitSystem): string {
  const km = m / 1000;
  if (units === 'imperial') return `${(km * 0.621371).toFixed(2)} mi`;
  return `${km.toFixed(2)} km`;
}
