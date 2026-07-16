// Owns the live (WebSocketSource-fed) entity bookkeeping that `EntityEngine`
// delegates to: add/update/remove HudEntities in place in the shared
// `entities` array, and route `type:'chaser'` wire entities into the engine's
// keyed `chasers` map (one marker per chaser device) instead of the roster.
import type { Entity } from 'shared';
import type { HudEntity } from './entity-types.js';
import type { Chaser } from './entity-engine.js';
import { createLiveHudEntity, applyLiveSample, prependTrailHistory, metaNumber } from './live-entity.js';

const MAX_CHASER_TRAIL_POINTS = 300;

export class LiveRoster {
  private readonly live = new Map<string, HudEntity>();

  constructor(
    private readonly entities: HudEntity[],
    private readonly chasers: Map<string, Chaser>,
  ) {}

  /** Replace the live roster wholesale (WS 'snapshot' on connect). */
  applySnapshot(wireEntities: Entity[]): void {
    const incomingIds = new Set(wireEntities.map((e) => e.id));
    for (const id of [...this.live.keys()]) {
      if (!incomingIds.has(id)) this.remove(id);
    }
    // Drop chasers no longer present in the snapshot (TTL-dropped, out of view).
    for (const id of [...this.chasers.keys()]) {
      if (!incomingIds.has(id)) this.chasers.delete(id);
    }
    wireEntities.forEach((e) => this.upsert(e));
  }

  /** Add or update one live entity (WS 'upsert'); routes `type:'chaser'` into `chasers`. */
  upsert(e: Entity): void {
    if (e.type === 'chaser') {
      this.upsertChaser(e);
      return;
    }
    const existing = this.live.get(e.id);
    if (existing) {
      applyLiveSample(existing, e);
      return;
    }
    const hud = createLiveHudEntity(e);
    this.live.set(e.id, hud);
    this.entities.push(hud);
  }

  private upsertChaser(e: Entity): void {
    let c = this.chasers.get(e.id);
    if (!c) {
      c = { id: e.id, name: e.name, lat: 0, lon: 0, hdg: 0, cur: null, fromLive: false, trail: [] };
      this.chasers.set(e.id, c);
    }
    c.name = e.name;
    c.lat = e.lat;
    c.lon = e.lon;
    c.hdg = metaNumber(e.meta, 'heading');
    c.cur = { lat: e.lat, lon: e.lon };
    c.fromLive = true;
    c.trail.push([e.lat, e.lon]);
    if (c.trail.length > MAX_CHASER_TRAIL_POINTS) c.trail.shift();
  }

  /** Drop one live entity or chaser (WS 'remove' — TTL sweep or store eviction). */
  remove(id: string): void {
    if (this.chasers.delete(id)) return;
    const hud = this.live.get(id);
    if (!hud) return;
    this.live.delete(id);
    const idx = this.entities.indexOf(hud);
    if (idx >= 0) this.entities.splice(idx, 1);
  }

  /** Prepend hydrated `/history/:id` points to a live entity's trail. */
  hydrateTrail(id: string, points: [number, number][]): void {
    const hud = this.live.get(id);
    if (hud) prependTrailHistory(hud, points);
  }
}
