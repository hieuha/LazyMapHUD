// Per-entity HUD renderer: trail (render-entity-trail.ts), heading/motion
// vector, marker glyph (aircraft/vehicle/balloon), label, and the pulsing
// corner reticle around the selected target. Ported verbatim from the
// mockup's drawEntity so pixels match.
import type { HudEntity } from '../entities/entity-types.js';
import type { RenderContext } from './render-context.js';
import { hexA, M_TO_FT, gridRef } from './format.js';
import { REDUCED } from '../state/store.js';
import { drawEntityTrail } from './render-entity-trail.js';

function gridRefScreen(rc: RenderContext, lat: number, lon: number): string {
  const p = rc.pt(lat, lon);
  const size = rc.size();
  return gridRef(p.x / size.x, p.y / size.y);
}

/** Off-screen margin (px) — entities just outside the viewport still draw their
 * trail tail approaching the edge, so skip a bit past the canvas bounds rather
 * than exactly at 0/hw/hh. N-entity perf: skips all draw work for entities
 * that can't possibly be visible instead of only culling the label later. */
const OFFSCREEN_MARGIN_PX = 80;

/** Below this zoom, only the selected entity's label draws (N-entity perf +
 * decluttering — with 50+ entities at a wide zoom, every label would overlap). */
const LABEL_MIN_ZOOM = 10;

export function drawEntity(rc: RenderContext, e: HudEntity, now: number): void {
  if (!e.cur) return;
  const { ctx } = rc;
  const s = e.cur;
  const isSel = e.id === rc.selectedId;
  const head = rc.pt(s.lat, s.lon);

  // ---- off-screen skip (cheap bounds check before any drawing work) ----
  if (
    !isSel &&
    (head.x < -OFFSCREEN_MARGIN_PX ||
      head.x > rc.hw + OFFSCREEN_MARGIN_PX ||
      head.y < -OFFSCREEN_MARGIN_PX ||
      head.y > rc.hh + OFFSCREEN_MARGIN_PX)
  ) {
    return;
  }

  const inRange = rc.warnIds.has(e.id);
  const flash = REDUCED ? 1 : 0.5 + 0.5 * Math.sin(now * 0.012);
  const col = inRange ? (flash > 0.5 ? '#ff3b30' : '#ff8a80') : e.color;

  drawEntityTrail(rc, e, head, isSel, col);

  // ---- heading / motion vector ----
  if (isSel) {
    const len = 26;
    const ang = (s.hdg * Math.PI) / 180; // 0deg = north (up)
    const vx = Math.sin(ang);
    const vy = -Math.cos(ang);
    const ex = head.x + vx * len;
    const ey = head.y + vy * len;
    ctx.strokeStyle = hexA(col, 0.8);
    ctx.lineWidth = 1.6;
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const ah = 5;
    const aa = 0.5;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - (vx * Math.cos(aa) - vy * Math.sin(aa)) * ah, ey - (vy * Math.cos(aa) + vx * Math.sin(aa)) * ah);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - (vx * Math.cos(-aa) - vy * Math.sin(-aa)) * ah, ey - (vy * Math.cos(-aa) + vx * Math.sin(-aa)) * ah);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ---- marker glyph ----
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.shadowColor = col;
  ctx.shadowBlur = isSel ? 12 : 5;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  if (e.kind === 'aircraft') {
    ctx.rotate((s.hdg * Math.PI) / 180);
    const sc = isSel ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(0, -7 * sc);
    ctx.lineTo(5 * sc, 6 * sc);
    ctx.lineTo(0, 3 * sc);
    ctx.lineTo(-5 * sc, 6 * sc);
    ctx.closePath();
    ctx.fill();
  } else if (e.kind === 'vehicle') {
    const sc = isSel ? 1.3 : 1;
    ctx.fillRect(-3.5 * sc, -3.5 * sc, 7 * sc, 7 * sc);
  } else {
    const r = isSel ? 6 : 4.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.shadowBlur = 0;

  // ---- label (culled by zoom at high entity counts; selected always labeled) ----
  if (isSel || (rc.zoom >= LABEL_MIN_ZOOM && e.kind !== 'vehicle')) {
    ctx.font = (isSel ? '600 ' : '') + '9px ui-monospace, Menlo, monospace';
    ctx.fillStyle = isSel ? col : hexA(col, 0.7);
    ctx.textAlign = 'left';
    ctx.fillText(e.id, head.x + 11, head.y - 8);
    if (isSel) {
      ctx.fillStyle = hexA(col, 0.75);
      ctx.fillText(
        'FL' + String(Math.round((s.alt_m * M_TO_FT) / 100)).padStart(3, '0') + ' · ' + gridRefScreen(rc, s.lat, s.lon),
        head.x + 11,
        head.y + 4,
      );
    }
  }

  // ---- pulsing corner reticle (selected only) ----
  if (isSel) {
    const pulse = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.006);
    const rr = 22 + pulse * 5;
    ctx.save();
    ctx.strokeStyle = hexA(col, 0.9);
    ctx.lineWidth = 1.3;
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    for (let q = 0; q < 4; q++) {
      const a0 = (q * Math.PI) / 2 + 0.35;
      const a1 = (q * Math.PI) / 2 + Math.PI / 2 - 0.35;
      ctx.beginPath();
      ctx.arc(head.x, head.y, rr, a0, a1);
      ctx.stroke();
    }
    ctx.restore();
  }
}
