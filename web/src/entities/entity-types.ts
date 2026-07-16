// HUD view-model entity — richer than the wire `Entity` (shared) because the HUD
// needs per-entity display metadata, trails, and a resolved `cur` sample. Every
// raw value stays in SI (meters, m/s).
import type { EntityMeta, EntityType } from 'shared';

/** A resolved per-frame sample fed to renderers/readouts. All SI. */
export interface EntitySample {
  lat: number;
  lon: number;
  /** altitude, meters MSL */
  alt_m: number;
  /** vertical velocity, m/s */
  vv: number;
  /** horizontal ground speed, m/s */
  vh: number;
  /** heading, degrees */
  hdg: number;
  sats: number;
  batt: number;
  frame: number;
  /** ISO source timestamp */
  t: string;
}

/** Marker geometry kind (drives glyph + ladder icon). */
export type EntityKind = 'radiosonde' | 'aircraft' | 'balloon' | 'vehicle';

/** Map a HUD kind to the canonical shared wire type. */
export function kindToWireType(kind: EntityKind): EntityType {
  return kind === 'radiosonde' ? 'balloon' : kind;
}

/** Where an entity's data comes from — drives the roster LIVE badge. */
export type EntitySourceKind = 'live';

export interface HudEntity {
  id: string;
  /** human-readable display name (from the wire `Entity.name`). */
  name: string;
  kind: EntityKind;
  /** live webhook-fed data (the only source). */
  source: EntitySourceKind;
  type: string;
  mfr: string;
  freq: number | null;
  classLabel: string;
  color: string;
  glyph: string;
  status: string;
  inZone: boolean;
  cur: EntitySample | null;
  /** arbitrary caller metadata (D5) — rendered verbatim in the detail panel. */
  meta?: EntityMeta;

  lat?: number;
  lon?: number;
  alt_m?: number;
  hdg?: number;
  spd?: number;
  vv?: number;
  vh?: number;
  sats?: number;
  batt?: number;
  trail?: [number, number][];
  frame?: number;

  /** cached great-circle distance (km) to the chaser, set by proximity */
  _km?: number;
}
