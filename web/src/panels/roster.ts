// Entity roster panel: builds the row list once, then refreshes altitude + status
// each tick. Clicking a row selects + tracks that entity.
import type { HudEntity } from '../entities/entity-types.js';
import { $, fmt, pad, altFtOfMeters } from '../hud/format.js';
import { store } from '../state/store.js';

export class Roster {
  private readonly el: HTMLElement;

  constructor(
    private readonly entities: HudEntity[],
    private readonly onSelect: (id: string) => void,
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
      const badge = `<span class="livedot" title="LIVE"></span>`;
      const ticoKind = e.kind === 'radiosonde' ? 'balloon' : e.kind;
      row.innerHTML =
        `<span class="tico t-${ticoKind}">${e.glyph}</span>` +
        `<span class="rid">${e.id.length > 9 ? e.id.slice(0, 9) : e.id}${badge}</span>` +
        `<span class="rtype">${e.classLabel}</span>` +
        `<span class="ralt" data-alt>—</span>` +
        `<span class="rstat"><span class="dot ok"></span></span>`;
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
      const row = this.el.querySelector<HTMLElement>(`.row[data-id="${e.id}"]`);
      if (!row || !e.cur) return;
      row.classList.toggle('sel', e.id === store.selectedId);
      const alt = row.querySelector<HTMLElement>('[data-alt]');
      if (alt) alt.textContent = fmt(Math.round(altFtOfMeters(e.cur.alt_m)));
      const dot = row.querySelector<HTMLElement>('.dot');
      if (dot) dot.className = 'dot ' + e.status;
    });
  }
}
