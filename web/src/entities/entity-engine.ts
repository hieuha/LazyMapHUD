// Entity engine: owns the mutable live entity list and the chaser. Live-only —
// entities exist solely via applySnapshot/Upsert/Remove (WebSocketSource),
// which populate the same `entities` array the render pipeline (roster,
// hud-canvas, altitude ladder) already reads.
import type { Entity } from 'shared';
import type { HudEntity } from './entity-types.js';
import { LiveRoster } from './live-roster.js';

export const COLORS: Record<string, string> = {
  balloon: '#7fd0ff',
  aircraft: '#37e0ff',
  vehicle: '#ffb020',
  radiosonde: '#7fd0ff',
};
export const CHASER_COLOR = '#7dff8f';
export const RANGE_M = 1000; // 1 km recovery ring

export interface Chaser {
  id: string;
  /** display name (from the wire entity's `name`); falls back to id. */
  name: string;
  lat: number;
  lon: number;
  hdg: number;
  cur: { lat: number; lon: number } | null;
  /** true once a live (webhook-fed) `type:'chaser'` entity has driven this chaser. */
  fromLive: boolean;
  /** this chaser's own recent path (each chaser tracks independently). */
  trail: [number, number][];
}

export class EntityEngine {
  // Mutable in place (push/splice), never reassigned — Roster/HudCanvas/
  // AltitudeLadder all hold this same array reference from construction, so
  // dynamic live add/remove must mutate it rather than replace it.
  readonly entities: HudEntity[] = [];
  // Live chasers keyed by id — a whole team of chaser devices can report at
  // once; each viewer picks their own (store.myChaserId) for ring/proximity.
  readonly chasers = new Map<string, Chaser>();
  private readonly liveRoster: LiveRoster;

  constructor() {
    this.liveRoster = new LiveRoster(this.entities, this.chasers);
  }

  // ---- live wire entities (WebSocketSource) — delegated to LiveRoster ----

  /** Replace the live roster wholesale (WS 'snapshot' on connect). */
  applySnapshot(wireEntities: Entity[]): void {
    this.liveRoster.applySnapshot(wireEntities);
  }

  /** Add or update one live entity (WS 'upsert'); routes `type:'chaser'` to `chaser`. */
  applyUpsert(e: Entity): void {
    this.liveRoster.upsert(e);
  }

  /** Drop one live entity (WS 'remove' — TTL sweep or store eviction). */
  applyRemove(id: string): void {
    this.liveRoster.remove(id);
  }

  /** Prepend hydrated `/history/:id` points to a live entity's trail (Phase 5 trail hydration). */
  hydrateTrail(id: string, points: [number, number][]): void {
    this.liveRoster.hydrateTrail(id, points);
  }
}
