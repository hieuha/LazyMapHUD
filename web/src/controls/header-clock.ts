// Live header clock — current wall-clock time (HH:MM:SS) shown in the topbar,
// following the UTC/ICT setting from the Time toggle (store.tz). Ticks every
// second. 'local' is labelled ICT to match the toggle button (the app's
// reference operating area is Vietnam, UTC+7).
import { store } from '../state/store.js';
import { $ } from '../hud/format.js';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Start the topbar clock; call render() immediately (e.g. on tz toggle) via the returned fn. */
export function wireHeaderClock(): () => void {
  const el = $('#hud-clock');
  const render = (): void => {
    if (!el) return;
    const d = new Date();
    const utc = store.tz === 'utc';
    const h = utc ? d.getUTCHours() : d.getHours();
    const m = utc ? d.getUTCMinutes() : d.getMinutes();
    const s = utc ? d.getUTCSeconds() : d.getSeconds();
    el.textContent = `${pad(h)}:${pad(m)}:${pad(s)} ${utc ? 'UTC' : 'ICT'}`;
  };
  render();
  setInterval(render, 1000);
  return render;
}
