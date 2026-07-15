// EntitySource: the single seam between the data feed and the render pipeline.
// `WebSocketSource` (ws-source.ts) is the only implementation — live WebSocket
// data is the sole source of entities.
import type { HudEntity } from './entity-types.js';

/** Callbacks a source pushes into. Mirrors the wire protocol (snapshot/upsert/remove). */
export interface EntitySourceHandlers {
  onSnapshot(entities: HudEntity[]): void;
  onUpsert(entity: HudEntity): void;
  onRemove(id: string): void;
}

export interface EntitySource {
  /** Begin producing entity updates into the supplied handlers. */
  start(handlers: EntitySourceHandlers): void;
  /** Advance one animation tick (a WS source ignores dt). */
  tick(dt: number): void;
  stop(): void;
}
