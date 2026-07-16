// "My chaser" picker — a compact topbar dropdown (styled to match the MAP
// popover) for choosing which live chaser this viewer owns (drives the 1 km
// ring + proximity). Hidden entirely when 0-1 chasers are live (nothing to
// disambiguate — resolveMyChaser auto-adopts a lone chaser). The option list is
// rebuilt only when the live chaser set changes so it never clobbers the
// operator's current selection mid-interaction.
import type { EntityEngine, Chaser } from '../entities/entity-engine.js';
import { setMyChaser } from '../chaser/my-chaser.js';
import { store } from '../state/store.js';
import { $ } from '../hud/format.js';

const AUTO_LABEL = '— auto —';

export class MyChaserPicker {
  private readonly wrap: HTMLElement | null;
  private readonly btn: HTMLButtonElement | null;
  private readonly pop: HTMLElement | null;
  private readonly cur: HTMLElement | null;
  private lastKey = '';

  constructor(
    private readonly engine: EntityEngine,
    /** Called with the chosen chaser id (‘’ = auto) — used to pan/track it. */
    private readonly onSelect?: (chaserId: string) => void,
  ) {
    this.wrap = $<HTMLElement>('#me-dd');
    this.btn = $<HTMLButtonElement>('#me-dd-btn');
    this.pop = $<HTMLElement>('#me-dd-pop');
    this.cur = $<HTMLElement>('#me-dd-cur');

    this.btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pop?.classList.toggle('open');
      this.btn?.setAttribute('aria-expanded', String(this.pop?.classList.contains('open') ?? false));
    });
    document.addEventListener('click', (e) => {
      if (!this.wrap?.contains(e.target as Node)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  private close(): void {
    this.pop?.classList.remove('open');
    this.btn?.setAttribute('aria-expanded', 'false');
  }

  /** Reconcile options + visibility with the current live chaser set. */
  refresh(): void {
    if (!this.wrap || !this.pop || !this.cur) return;
    const chasers = [...this.engine.chasers.values()].sort((a, b) => a.id.localeCompare(b.id));

    // Auto-handled when 0-1 chasers exist — hide the control entirely.
    if (chasers.length <= 1) {
      this.wrap.hidden = true;
      this.close();
      this.lastKey = '';
      return;
    }
    this.wrap.hidden = false;

    // Rebuild options only when the id/name set changed (cheap idempotent guard).
    const key = chasers.map((c) => `${c.id} ${c.name}`).join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.pop.replaceChildren(
        this.buildOption('', AUTO_LABEL),
        ...chasers.map((c) => this.buildOption(c.id, c.name)),
      );
    }
    this.syncSelection(chasers);
  }

  /** Reflect the current store.myChaserId in the button label + the checked row. */
  private syncSelection(chasers: Chaser[]): void {
    const selected = chasers.find((c) => c.id === store.myChaserId);
    if (this.cur) this.cur.textContent = selected ? selected.name : AUTO_LABEL;
    this.pop?.querySelectorAll<HTMLElement>('.map-opt').forEach((el) => {
      el.classList.toggle('on', (el.dataset.id ?? '') === store.myChaserId);
    });
  }

  private buildOption(id: string, label: string): HTMLElement {
    const opt = document.createElement('div');
    opt.className = 'map-opt';
    opt.dataset.id = id;
    opt.setAttribute('role', 'option');
    const radio = document.createElement('span');
    radio.className = 'radio';
    const text = document.createElement('span');
    text.textContent = label; // textContent keeps free-form chaser names inert
    opt.append(radio, text);
    opt.addEventListener('click', () => {
      setMyChaser(id);
      this.close();
      this.syncSelection([...this.engine.chasers.values()]);
      if (id) this.onSelect?.(id); // pan/track the picked chaser (not for “— auto —”)
    });
    return opt;
  }
}
