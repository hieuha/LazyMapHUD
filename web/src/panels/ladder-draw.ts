// Altitude-ladder draw routines (vertical + horizontal). Split out of the ladder
// class to keep each module focused; ported verbatim from the mockup makeLadder.
import type { HudEntity } from '../entities/entity-types.js';
import { hexA, ALT_MAX_FT, ladderTick, ladderUnitCaption, altFtOfMeters } from '../hud/format.js';
import { store } from '../state/store.js';

type Ctx = CanvasRenderingContext2D;

export function drawLadderVertical(ctx: Ctx, W: number, H: number, entities: HudEntity[]): void {
  const padT = 16;
  const padB = 22;
  const axisX = 40;
  const top = padT;
  const bot = H - padB;
  const altToY = (a: number): number => bot - (a / ALT_MAX_FT) * (bot - top);
  ctx.strokeStyle = 'rgba(55,224,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(axisX, top);
  ctx.lineTo(axisX, bot);
  ctx.stroke();
  const band = ctx.createLinearGradient(0, top, 0, bot);
  band.addColorStop(0, 'rgba(55,224,255,0.06)');
  band.addColorStop(0.55, 'rgba(55,224,255,0.03)');
  band.addColorStop(1, 'rgba(255,59,48,0.04)');
  ctx.fillStyle = band;
  ctx.fillRect(axisX, top, W - axisX - 6, bot - top);
  ctx.font = '8.5px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (let a = 0; a <= ALT_MAX_FT; a += 10000) {
    const y = altToY(a);
    ctx.strokeStyle = 'rgba(159,182,194,0.5)';
    ctx.beginPath();
    ctx.moveTo(axisX - 6, y);
    ctx.lineTo(axisX, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159,182,194,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(ladderTick(a, store.units), axisX - 8, y);
    ctx.strokeStyle = 'rgba(55,224,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(axisX, y);
    ctx.lineTo(W - 4, y);
    ctx.stroke();
  }
  for (let a = 5000; a < ALT_MAX_FT; a += 10000) {
    const y = altToY(a);
    ctx.strokeStyle = 'rgba(95,116,128,0.45)';
    ctx.beginPath();
    ctx.moveTo(axisX - 3, y);
    ctx.lineTo(axisX, y);
    ctx.stroke();
  }

  const list = [...entities]
    .filter((e) => e.cur)
    .sort((a, b) => Number(a.id === store.selectedId) - Number(b.id === store.selectedId));
  const mx = W - 6 - 20;
  list.forEach((e) => {
    const isSel = e.id === store.selectedId;
    const y = altToY(altFtOfMeters(e.cur!.alt_m));
    const col = e.color;
    ctx.strokeStyle = isSel ? hexA(col, 0.5) : 'rgba(95,116,128,0.22)';
    ctx.lineWidth = isSel ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 6, y);
    ctx.lineTo(mx, y);
    ctx.stroke();
    if (Math.abs(e.cur!.vv) > 0.2) {
      ctx.fillStyle = e.cur!.vv > 0 ? '#3dffa0' : '#ff3b30';
      const up = e.cur!.vv > 0;
      const ax = axisX + 3;
      ctx.beginPath();
      ctx.moveTo(ax, y + (up ? -3 : 3));
      ctx.lineTo(ax - 2.5, y + (up ? 1 : -1));
      ctx.lineTo(ax + 2.5, y + (up ? 1 : -1));
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = isSel ? 9 : 4;
    ctx.fillStyle = col;
    if (e.kind === 'aircraft') ctx.fillRect(mx - 3, y - 3, 6, 6);
    else if (e.kind === 'vehicle') {
      ctx.beginPath();
      ctx.moveTo(mx, y - 3.6);
      ctx.lineTo(mx + 3.4, y + 2.2);
      ctx.lineTo(mx - 3.4, y + 2.2);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(mx, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (isSel) {
      ctx.fillStyle = 'rgba(55,224,255,0.08)';
      ctx.fillRect(axisX, y - 8, W - axisX - 6, 16);
      ctx.strokeStyle = hexA(col, 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(axisX, y - 8, W - axisX - 6, 16);
    }
    ctx.font = (isSel ? '600 ' : '') + '7.5px ui-monospace, monospace';
    ctx.fillStyle = isSel ? col : 'rgba(159,182,194,0.7)';
    ctx.textAlign = 'left';
    const lbl = e.id.split('-')[1] || e.id.slice(-4);
    ctx.fillText(lbl, mx + 6, y);
  });
  ctx.fillStyle = 'rgba(95,116,128,0.5)';
  ctx.font = '7.5px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ladderUnitCaption(store.units), 4, top - 8 < 6 ? 8 : top - 8);
}

export function drawLadderHorizontal(ctx: Ctx, W: number, H: number, entities: HudEntity[]): void {
  const padL = 30;
  const padR = 10;
  const top = 10;
  const bot = H - 20;
  const axisY = bot;
  const altToX = (a: number): number => padL + (a / ALT_MAX_FT) * (W - padL - padR);
  ctx.strokeStyle = 'rgba(55,224,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, axisY);
  ctx.lineTo(W - padR, axisY);
  ctx.stroke();
  ctx.font = '8px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  for (let a = 0; a <= ALT_MAX_FT; a += 10000) {
    const x = altToX(a);
    ctx.strokeStyle = 'rgba(95,116,128,0.45)';
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(95,116,128,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(ladderTick(a, store.units), x, axisY + 6);
  }
  [...entities]
    .filter((e) => e.cur)
    .forEach((e) => {
      const isSel = e.id === store.selectedId;
      const x = altToX(altFtOfMeters(e.cur!.alt_m));
      const col = e.color;
      ctx.strokeStyle = isSel ? hexA(col, 0.6) : 'rgba(95,116,128,0.3)';
      ctx.lineWidth = isSel ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, axisY);
      ctx.lineTo(x, top + 6);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = isSel ? 9 : 4;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, top + 6, isSel ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (isSel) {
        ctx.fillStyle = col;
        ctx.font = '600 8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.id.slice(-4), x, top - 4);
      }
    });
}
