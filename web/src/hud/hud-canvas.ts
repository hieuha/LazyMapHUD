// HUD overlay canvas (pointer-events:none): sizing/DPR, grid rebuild, and the
// per-frame draw that composes markers, trails, crosshair, and chaser.
// Non-selected entities draw first, the selected one last (on top).
import type L from 'leaflet';
import type { EntityEngine } from '../entities/entity-engine.js';
import { store } from '../state/store.js';
import { buildHudGrid } from './render-grid.js';
import { drawEntity } from './render-entities.js';
import { drawCrosshair } from './render-crosshair.js';
import { drawChaser } from './render-chaser.js';
import { resolveMyChaser } from '../chaser/my-chaser.js';
import type { RenderContext } from './render-context.js';

export class HudCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private hw = 0;
  private hh = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(
    private readonly engine: EntityEngine,
    private readonly pt: (lat: number, lon: number) => L.Point,
    private readonly mapSize: () => L.Point,
    private readonly warnIds: Set<string>,
    private readonly getZoom: () => number = () => 13,
  ) {
    const el = document.getElementById('hud') as HTMLCanvasElement | null;
    if (!el) throw new Error('#hud canvas missing');
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  size(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    this.hw = r.width;
    this.hh = r.height;
    this.canvas.width = this.hw * this.dpr;
    this.canvas.height = this.hh * this.dpr;
    this.canvas.style.width = `${this.hw}px`;
    this.canvas.style.height = `${this.hh}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    buildHudGrid(this.hw, this.hh);
  }

  draw(now: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.hw, this.hh);

    const rc: RenderContext = {
      ctx,
      hw: this.hw,
      hh: this.hh,
      now,
      pt: this.pt,
      size: this.mapSize,
      selectedId: store.selectedId,
      warnIds: this.warnIds,
      entities: this.engine.entities,
      zoom: this.getZoom(),
    };

    // non-selected first, selected last (on top)
    this.engine.entities.forEach((e) => {
      if (e.id !== store.selectedId) drawEntity(rc, e, now);
    });
    const sel = this.engine.entities.find((e) => e.id === store.selectedId);
    if (sel) drawEntity(rc, sel, now);
    drawCrosshair(rc);
    // Draw every live chaser (whole team); the viewer's own renders highlighted
    // and last (on top). Only chasers fed a real position are drawn.
    const mine = resolveMyChaser(this.engine);
    for (const c of this.engine.chasers.values()) {
      if (c.fromLive && c !== mine) drawChaser(rc, c, store.units, false);
    }
    if (mine?.fromLive) drawChaser(rc, mine, store.units, true);
  }
}
