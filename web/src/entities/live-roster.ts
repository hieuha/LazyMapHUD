// Owns the live (WebSocketSource-fed) entity bookkeeping that `EntityEngine`
// delegates to: add/update/remove HudEntities in place in the shared
// `entities` array, and route `type:'chaser'` wire entities onto the engine's
// single `Chaser` marker instead of the roster (proximity/ring/render-chaser
// all key off `engine.chaser`, not a roster row).
import type { Entity } from 'shared';
import type { HudEntity } from './entity-types.js';
import type { Chaser } from './entity-engine.js';
import { createLiveHudEntity, applyLiveSample, prependTrailHistory } from './live-entity.js';

const MAX_CHASER_TRAIL_POINTS = 300;

export class LiveRoster {
  private readonly live = new Map<string, HudEntity>();

  constructor(
    private readonly entities: HudEntity[],
    private readonly chaser: Chaser,
    private readonly chaserTrail: [number, number][],
  ) {}

  /** Replace the live roster wholesale (WS 'snapshot' on connect). */
  applySnapshot(wireEntities: Entity[]): void {
    const incomingIds = new Set(wireEntities.map((e) => e.id));
    for (const id of [...this.live.keys()]) {
      if (!incomingIds.has(id)) this.remove(id);
    }
    wireEntities.forEach((e) => this.upsert(e));
  }

  /** Add or update one live entity (WS 'upsert'); routes `type:'chaser'` to `chaser`. */
  upsert(e: Entity): void {
    if (e.type === 'chaser') {
      this.chaser.id = e.id;
      this.chaser.lat = e.lat;
      this.chaser.lon = e.lon;
      this.chaser.hdg = e.heading;
      this.chaser.cur = { lat: e.lat, lon: e.lon };
      this.chaser.fromLive = true;
      this.chaserTrail.push([e.lat, e.lon]);
      if (this.chaserTrail.length > MAX_CHASER_TRAIL_POINTS) this.chaserTrail.shift();
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

  /** Drop one live entity (WS 'remove' — TTL sweep or store eviction). */
  remove(id: string): void {
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
