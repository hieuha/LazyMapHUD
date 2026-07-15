// Timezone toggle (UTC / local ICT). Reformats all absolute timestamps.
import type { Timezone } from '../state/store.js';
import { store } from '../state/store.js';

export function wireTimezoneToggle(onChange: () => void): void {
  document.querySelectorAll<HTMLButtonElement>('#seg-tz button').forEach((b) => {
    b.addEventListener('click', () => {
      store.tz = (b.dataset.tz as Timezone) ?? 'utc';
      document.querySelectorAll('#seg-tz button').forEach((x) => x.classList.toggle('on', x === b));
      onChange();
    });
  });
}
