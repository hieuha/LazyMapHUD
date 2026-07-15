// HUD-specific formatters + geometry helpers that are NOT part of the shared
// units module (ladder axis, ring label, grid ref, small canvas math). Shared
// formatters (altitude/climb/speed/distance) are reused directly from `shared`.
import type { UnitSystem } from 'shared';
import { metersToFeet } from 'shared';
import type { Timezone } from '../state/store.js';

export const M_TO_FT = 3.28084;
export const ALT_MAX_FT = 64000;
export const GRID_ROWS = 'ABCDEFG'.split('');
export const GRID_COLS = 10;

export const $ = <T extends Element = Element>(s: string): T | null =>
  document.querySelector<T>(s);

export const fmt = (n: number, d = 0): string =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pad = (n: number): string => String(n).padStart(2, '0');

/** #rrggbb + alpha -> rgba() string (canvas stroke/fill with transparency). */
export const hexA = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function altUnitLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'FT MSL' : 'M MSL';
}

/** Ladder axis tick: internal ladder scale is feet-based. */
export function ladderTick(aFt: number, units: UnitSystem): string {
  if (aFt === 0) return 'GND';
  if (units === 'imperial') return `${aFt / 1000}k`;
  const km = aFt / M_TO_FT / 1000; // ft -> m -> km
  return `${km >= 10 ? Math.round(km) : km.toFixed(1)}k`;
}

export function ladderUnitCaption(units: UnitSystem): string {
  return units === 'imperial' ? 'FT ×1000' : 'M ×1000';
}

/** 1 km ring label (radius stays a true 1000 m regardless of units). */
export function ringLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'R0.62 MI' : 'R1.0 KM';
}

/** ISO timestamp -> "HH:MM:SS <ZONE>". Local = device tz (Vietnam = ICT, UTC+7). */
export function fmtTime(iso: string, tz: Timezone): string {
  const d = new Date(iso);
  if (tz === 'utc') {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ICT`;
}

export function altFtOfMeters(m: number): number {
  return metersToFeet(m);
}

/** Grid reference (A-G / 1-10) from a screen fraction of the map. */
export function gridRef(fx: number, fy: number): string {
  const row = GRID_ROWS[Math.floor(clamp(fy, 0, 0.999) * GRID_ROWS.length)] ?? 'A';
  return row + String(Math.floor(clamp(fx, 0, 0.999) * GRID_COLS) + 1).padStart(2, '0');
}
