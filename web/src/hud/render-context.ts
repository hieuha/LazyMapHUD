// Shared context handed to every HUD sub-renderer each frame. Bundles the canvas
// 2D context, dimensions, the map projection, and the frame-specific state
// (selected id, in-range ids) so renderers stay pure-ish functions.
import type L from 'leaflet';
import type { HudEntity } from '../entities/entity-types.js';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  hw: number;
  hh: number;
  now: number;
  pt: (lat: number, lon: number) => L.Point;
  size: () => L.Point;
  selectedId: string;
  warnIds: Set<string>;
  entities: HudEntity[];
  /** current map zoom — drives label culling at high entity counts (N-entity perf). */
  zoom: number;
}
