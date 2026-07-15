// Full-span RED targeting crosshair locked to the active target. Drawn only while
// TRACK LOCK is engaged; a ~GAP px window is left around the object so the
// marker/label stay readable. Recomputed every frame so it follows the target.
import type { RenderContext } from './render-context.js';
import { store } from '../state/store.js';

export function drawCrosshair(rc: RenderContext): void {
  if (!store.trackLock) return;
  const e = rc.entities.find((x) => x.id === rc.selectedId);
  if (!e || !e.cur) return;
  const { ctx } = rc;
  const c = rc.pt(e.cur.lat, e.cur.lon);
  const GAP = 14; // clear window around the icon
  ctx.save();
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 1;
  ctx.shadowColor = 'rgba(255,59,48,0.9)';
  ctx.shadowBlur = 4;
  // horizontal line (full width, split around the target)
  ctx.beginPath();
  ctx.moveTo(0, c.y);
  ctx.lineTo(c.x - GAP, c.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x + GAP, c.y);
  ctx.lineTo(rc.hw, c.y);
  ctx.stroke();
  // vertical line (full height, split around the target)
  ctx.beginPath();
  ctx.moveTo(c.x, 0);
  ctx.lineTo(c.x, c.y - GAP);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x, c.y + GAP);
  ctx.lineTo(c.x, rc.hh);
  ctx.stroke();
  // small brackets framing the intersection window
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,59,48,0.85)';
  ctx.lineWidth = 1.2;
  const b = GAP;
  const t = 5;
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(c.x + sx * b, c.y + sy * b - sy * t);
    ctx.lineTo(c.x + sx * b, c.y + sy * b);
    ctx.lineTo(c.x + sx * b - sx * t, c.y + sy * b);
    ctx.stroke();
  });
  ctx.restore();
}
