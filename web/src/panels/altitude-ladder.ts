// Altitude ladder — stacks ALL entities on a feet-based scale. Supports a vertical
// (right rail) and a horizontal (mobile) variant. Draw routines live in
// ladder-draw.ts; this class owns the canvas sizing/DPR and dispatch.
import type { HudEntity } from '../entities/entity-types.js';
import { drawLadderVertical, drawLadderHorizontal } from './ladder-draw.js';

export class AltitudeLadder {
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  constructor(
    canvasId: string,
    private readonly entities: HudEntity[],
    private readonly horizontal = false,
  ) {
    const cv = document.querySelector<HTMLCanvasElement>(canvasId);
    if (!cv) throw new Error(`${canvasId} missing`);
    this.cv = cv;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.size();
  }

  size(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = this.cv.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    this.w = r.width;
    this.h = this.horizontal ? 110 : r.height;
    this.cv.width = this.w * dpr;
    this.cv.height = this.h * dpr;
    this.cv.style.width = `${this.w}px`;
    this.cv.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (this.horizontal) drawLadderHorizontal(this.ctx, this.w, this.h, this.entities);
    else drawLadderVertical(this.ctx, this.w, this.h, this.entities);
  }
}
