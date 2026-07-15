// Friendly CHASER unit renderer: trail + chevron glyph + label. The 1 km ring
// itself is a Leaflet layer (see MapController); this draws the canvas marker.
// The webhook-fed `type:'chaser'` entity drives the ring/proximity.
import type { RenderContext } from './render-context.js';
import type { Chaser } from '../entities/entity-engine.js';
import { CHASER_COLOR } from '../entities/entity-engine.js';
import { hexA, ringLabel } from './format.js';
import type { UnitSystem } from 'shared';

export function drawChaser(
  rc: RenderContext,
  chaser: Chaser,
  chaserTrail: [number, number][],
  units: UnitSystem,
): void {
  if (!chaser.cur) return;
  const { ctx } = rc;
  const p = rc.pt(chaser.cur.lat, chaser.cur.lon);
  const col = CHASER_COLOR;
  // trail
  if (chaserTrail.length > 1) {
    const tp = chaserTrail.map(([la, lo]) => rc.pt(la, lo));
    tp.push(p);
    ctx.strokeStyle = hexA(col, 0.35);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    tp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  // chevron pointing along heading
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((chaser.hdg || 0) * Math.PI) / 180);
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5.5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5.5, 6);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.shadowBlur = 0;
  // label
  ctx.font = '600 9px ui-monospace, Menlo, monospace';
  ctx.fillStyle = col;
  ctx.textAlign = 'left';
  ctx.fillText(chaser.id + ' ✚', p.x + 11, p.y - 8);
  ctx.fillStyle = hexA(col, 0.7);
  ctx.fillText('RECOVERY · ' + ringLabel(units), p.x + 11, p.y + 4);
}
