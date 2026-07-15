// Hero + detail readout panel driven by the selected entity. `select()` swaps the
// static hero metadata; `update()` refreshes live values each tick. All raw
// values are SI; shared formatters render them. `clear()` resets the panel to
// its placeholder state when nothing is selected/tracked (empty roster,
// disconnect, or the tracked entity dropped out via TTL removal).
import type { HudEntity } from '../entities/entity-types.js';
import type { EntityEngine } from '../entities/entity-engine.js';
import {
  formatAltitude,
  formatClimb,
  formatSpeed,
  metersToFeet,
} from 'shared';
import { $, fmt, clamp, altUnitLabel, fmtTime, gridRef, ALT_MAX_FT, M_TO_FT } from '../hud/format.js';
import { store } from '../state/store.js';

const setText = (sel: string, v: string): void => {
  const el = $(sel);
  if (el) el.textContent = v;
};

/** Show/hide the hero + detail readout blocks. Hidden when nothing is selected
 * so the panel collapses to the roster instead of a "—" placeholder readout. */
const setSelectionVisible = (visible: boolean): void => {
  ['#hero', '#detail'].forEach((sel) => {
    const el = $<HTMLElement>(sel);
    if (el) el.classList.toggle('empty', !visible);
  });
};

/** Generic hero "PEAK" reference ceiling — there is no flight-plan summary for
 * live entities, so the ascent bar scales against a fixed altitude ceiling. */
const HERO_CEILING_M = ALT_MAX_FT / M_TO_FT;

const DETAIL_FIELD_SELECTORS = [
  '#stat-alt',
  '#h-alt-ft',
  '#h-alt-m',
  '#h-ceil',
  '#ascent-pct',
  '#d-lat',
  '#d-lon',
  '#d-climb',
  '#d-spd',
  '#d-hdg',
  '#d-sats',
  '#d-grid',
];

export class DetailReadout {
  constructor(
    private readonly engine: EntityEngine,
    private readonly mapSize: () => { x: number; y: number },
    private readonly ptFrac: (lat: number, lon: number) => { x: number; y: number },
  ) {}

  private gridRefScreen(lat: number, lon: number): string {
    const p = this.ptFrac(lat, lon);
    const size = this.mapSize();
    return gridRef(p.x / size.x, p.y / size.y);
  }

  select(id: string): void {
    const e = this.engine.entities.find((x) => x.id === id);
    if (!e) {
      this.clear();
      return;
    }
    setText('#track-id', e.id);
    const glyph = $<HTMLElement>('#h-glyph');
    if (glyph) {
      glyph.textContent = e.glyph;
      glyph.style.color = e.color;
    }
    setText('#h-serial', e.id);
    const badge = $<HTMLElement>('#h-badge');
    if (badge) {
      badge.textContent = 'LIVE';
      badge.classList.add('real');
    }
    setText('#h-mfr', e.mfr || '—');
    setText('#h-freq', e.freq ? e.freq.toFixed(1) + ' MHz' : '—');
    setText('#h-class', e.classLabel);
    this.renderMeta(e.meta);
    setSelectionVisible(true);
  }

  /** Reset the top-bar tracking id, hero, detail grid, and metadata block to
   * their empty placeholder state — no stale last-selected entity values. */
  clear(): void {
    setText('#track-id', '—');
    const glyph = $<HTMLElement>('#h-glyph');
    if (glyph) {
      glyph.textContent = '—';
      glyph.style.color = '';
    }
    setText('#h-serial', '—');
    const badge = $<HTMLElement>('#h-badge');
    if (badge) {
      badge.textContent = '—';
      badge.classList.remove('real');
    }
    setText('#h-mfr', '—');
    setText('#h-freq', '—');
    setText('#h-class', '—');
    DETAIL_FIELD_SELECTORS.forEach((sel) => setText(sel, '—'));
    const fill = $<HTMLElement>('#ascent-fill');
    if (fill) fill.style.width = '0%';
    const batt = $<HTMLElement>('#d-batt');
    if (batt) batt.innerHTML = '—';
    this.renderMeta(undefined);
    setSelectionVisible(false);
  }

  /** Render the METADATA block for the selected entity's `meta` (D5); hidden when none.
   * Built with DOM APIs (not innerHTML) since keys/values are arbitrary caller-supplied
   * strings — textContent keeps them inert regardless of content. */
  private renderMeta(meta: HudEntity['meta']): void {
    const block = $<HTMLElement>('#meta-block');
    const grid = $<HTMLElement>('#meta-grid');
    if (!block || !grid) return;
    const entries = meta ? Object.entries(meta) : [];
    block.classList.toggle('empty', entries.length === 0);
    grid.replaceChildren(
      ...entries.map(([k, v]) => {
        const cell = document.createElement('div');
        cell.className = 'mcell';
        const key = document.createElement('div');
        key.className = 'mk';
        key.textContent = k;
        const val = document.createElement('div');
        val.className = 'mv';
        val.textContent = String(v);
        cell.append(key, val);
        return cell;
      }),
    );
  }

  /** Refresh live values for the currently selected/tracked entity. If nothing
   * is selected, or the tracked entity is no longer present in the roster
   * (TTL removal / disconnect snapshot without it), clears selection + the
   * panel instead of showing stale last-known values. */
  update(): void {
    if (!store.selectedId) {
      this.clear();
      return;
    }
    const e = this.engine.entities.find((x) => x.id === store.selectedId);
    if (!e || !e.cur) {
      store.selectedId = '';
      this.clear();
      return;
    }
    const s = e.cur;
    const altFt = metersToFeet(s.alt_m);
    const u = store.units;

    setText('#stat-alt', formatAltitude(s.alt_m, u));
    setText('#stat-frame', '#' + s.frame);
    setText('#stat-clock', fmtTime(s.t, store.tz));

    if (u === 'imperial') {
      setText('#h-alt-ft', fmt(Math.round(altFt)));
      setText('#h-alt-m', fmt(Math.round(s.alt_m)) + ' m');
    } else {
      setText('#h-alt-ft', fmt(Math.round(s.alt_m)));
      setText('#h-alt-m', fmt(Math.round(altFt)) + ' ft');
    }
    setText('#h-alt-unit', altUnitLabel(u));
    setText('#h-ceil', formatAltitude(HERO_CEILING_M, u).replace(/ (ft|m)$/, ''));
    setText('#h-ceil-unit', u === 'imperial' ? 'ft' : 'm');
    const pct = clamp(s.alt_m / HERO_CEILING_M, 0, 1) * 100;
    const fill = $<HTMLElement>('#ascent-fill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    setText('#ascent-pct', Math.round(pct) + '%');

    setText('#d-lat', s.lat.toFixed(5) + '°');
    setText('#d-lon', s.lon.toFixed(5) + '°');
    const cEl = $<HTMLElement>('#d-climb');
    if (cEl) {
      cEl.textContent = formatClimb(s.vv, u);
      cEl.className = 'dv ' + (s.vv > 0.3 ? 'climb-up' : s.vv < -0.3 ? 'climb-down' : '');
    }
    setText('#d-spd', formatSpeed(s.vh, u));
    setText('#d-hdg', String(Math.round(s.hdg)).padStart(3, '0') + '°');
    setText('#d-sats', String(s.sats));
    const batt = $<HTMLElement>('#d-batt');
    if (batt) batt.innerHTML = (s.batt || 0).toFixed(1) + '<span class="unit">V</span>';
    setText('#d-grid', this.gridRefScreen(s.lat, s.lon));
  }
}
