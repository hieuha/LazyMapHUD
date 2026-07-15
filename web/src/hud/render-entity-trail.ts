// Trail rendering (dim full path + bright recent tail), split out of
// render-entities.ts to keep it under the file-size budget. Ported verbatim
// from the mockup's drawEntity so pixels match.
import type { HudEntity } from '../entities/entity-types.js';
import type { RenderContext } from './render-context.js';
import { hexA } from './format.js';

interface Point2D {
  x: number;
  y: number;
}

/** Draws the full dim trail + bright recent tail; returns the entity's
 * projected head point (callers reuse it for the marker/label/reticle). */
export function drawEntityTrail(rc: RenderContext, e: HudEntity, head: Point2D, isSel: boolean, col: string): void {
  const { ctx } = rc;
  const trailPts: Point2D[] = (e.trail ?? []).map(([la, lo]) => rc.pt(la, lo));
  trailPts.push(head);
  if (trailPts.length <= 1) return;

  ctx.strokeStyle = hexA(e.color, isSel ? 0.3 : 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  trailPts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();

  const rcStart = Math.max(0, trailPts.length - 26);
  ctx.strokeStyle = hexA(col, isSel ? 0.9 : 0.5);
  ctx.lineWidth = isSel ? 2 : 1.3;
  ctx.shadowColor = col;
  ctx.shadowBlur = isSel ? 7 : 3;
  ctx.beginPath();
  for (let i = rcStart; i < trailPts.length; i++) {
    const p = trailPts[i]!;
    i === rcStart ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}
