// Entity roster panel: builds the row list once, then refreshes altitude + status
// each tick. Clicking a row selects + tracks that entity.
import type { HudEntity } from '../entities/entity-types.js';
import { $, fmt, pad, altFtOfMeters } from '../hud/format.js';
import { store } from '../state/store.js';

/** Escape a caller-supplied string for safe innerHTML interpolation (name is free-form). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class Roster {
  private readonly el: HTMLElement;

  constructor(
    private readonly entities: HudEntity[],
    private readonly onSelect: (id: string) => void,
    /** ids currently inside a chaser recovery ring — flagged red in the list. */
    private readonly warnIds: ReadonlySet<string> = new Set(),
  ) {
    const el = $<HTMLElement>('#roster');
    if (!el) throw new Error('#roster missing');
    this.el = el;
  }

  build(): void {
    this.el.innerHTML = '';
    this.entities.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'row' + (e.id === store.selectedId ? ' sel' : '');
      row.dataset.id = e.id;
      const label = e.name.length > 9 ? e.name.slice(0, 9) : e.name;
      // No leading type glyph — just name / type / alt / status dot. The single
      // status dot on the far right carries all state (live vs. in-ring warning).
      row.innerHTML =
        `<span class="rid">${escapeHtml(label)}</span>` +
        `<span class="rtype">${e.classLabel}</span>` +
        `<span class="ralt" data-alt>—</span>` +
        `<span class="rstat"><span class="dot live"></span></span>`;
      row.addEventListener('click', () => this.onSelect(e.id));
      this.el.appendChild(row);
    });
    const count = pad(this.entities.length);
    const rc = $('#roster-count');
    const sc = $('#stat-count');
    if (rc) rc.textContent = count;
    if (sc) sc.textContent = count;
  }

  refresh(): void {
    this.entities.forEach((e) => {
      // CSS.escape the free-form id: a chaser/webhook id like `a"]` would
      // otherwise produce an invalid selector and throw SyntaxError out of the
      // render loop (freezing the HUD for every viewer that received it).
      const row = this.el.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(e.id)}"]`);
      if (!row || !e.cur) return;
      row.classList.toggle('sel', e.id === store.selectedId);
      row.classList.toggle('warn', this.warnIds.has(e.id));
      const alt = row.querySelector<HTMLElement>('[data-alt]');
      if (alt) alt.textContent = fmt(Math.round(altFtOfMeters(e.cur.alt_m)));
      const dot = row.querySelector<HTMLElement>('.dot');
      if (dot) dot.className = 'dot ' + (this.warnIds.has(e.id) ? 'crit' : 'live');
    });
  }
}
