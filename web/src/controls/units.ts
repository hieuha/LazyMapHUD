// Units toggle (metric/imperial). Reformats everything at next render — raw values
// stay SI internally, so toggling only changes formatting, never source data.
import type { UnitSystem } from 'shared';
import { store } from '../state/store.js';

export function wireUnitsToggle(onChange: () => void): void {
  document.querySelectorAll<HTMLButtonElement>('#seg-units button').forEach((b) => {
    b.addEventListener('click', () => {
      store.units = (b.dataset.units as UnitSystem) ?? 'metric';
      document.querySelectorAll('#seg-units button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(); // instant reflect on DOM readouts (ladder/HUD reflect next frame)
    });
  });
}
