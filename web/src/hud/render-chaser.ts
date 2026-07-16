// Friendly CHASER unit renderer: trail + chevron glyph + label. The 1 km ring
// itself is a Leaflet layer (see MapController); this draws the canvas marker.
// The webhook-fed `type:'chaser'` entity drives the ring/proximity.
import type { RenderContext } from './render-context.js';
import type { Chaser } from '../entities/entity-engine.js';
import { CHASER_COLOR } from '../entities/entity-engine.js';
import { hexA, ringLabel } from './format.js';
import type { UnitSystem } from 'shared';

/** Max chaser-name chars drawn on the map — keeps the label short like a callsign. */
const CHASER_LABEL_MAX = 9;

export function drawChaser(
  rc: RenderContext,
  chaser: Chaser,
  units: UnitSystem,
  isMine: boolean,
): void {
  if (!chaser.cur) return;
  const { ctx } = rc;
  const p = rc.pt(chaser.cur.lat, chaser.cur.lon);
  const col = CHASER_COLOR;
  // The viewer's own chaser renders at full strength; teammates' chasers are
  // dimmed so the map reads clearly at a glance which unit is "me".
  const dim = isMine ? 1 : 0.5;
  const trail = chaser.trail;
  // trail
  if (trail.length > 1) {
    const tp = trail.map(([la, lo]) => rc.pt(la, lo));
    tp.push(p);
    ctx.strokeStyle = hexA(col, 0.35 * dim);
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
  ctx.shadowBlur = isMine ? 10 : 4;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.globalAlpha = dim;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5.5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5.5, 6);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 0.5 * dim;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.shadowBlur = 0;
  // label — a single line: the chaser name (truncated to a callsign-ish length
  // so a long name can't run across the map), plus the recovery-ring radius in
  // parentheses on the viewer's own chaser (the ring is drawn only around it).
  const name = chaser.name.length > CHASER_LABEL_MAX ? chaser.name.slice(0, CHASER_LABEL_MAX) : chaser.name;
  const label = isMine ? `${name} (${ringLabel(units)})` : name;
  ctx.font = '600 9px ui-monospace, Menlo, monospace';
  ctx.fillStyle = hexA(col, dim);
  ctx.textAlign = 'left';
  ctx.fillText(label, p.x + 11, p.y - 4);
}
