// TRACK LOCK is toggled via the top-bar TRACKING badge (there's no separate
// map button anymore). Re-engaging the lock clears the manual-drag suspend so
// followCam snaps the camera back onto the active target immediately. (Clicking
// a roster row/entity also flies the camera back to the target.)
import { $ } from '../hud/format.js';
import { store } from '../state/store.js';

export function setLockUI(on: boolean): void {
  const badge = $('#tracking-badge');
  badge?.classList.toggle('off', !on);
  badge?.setAttribute('aria-pressed', String(on));
}

function toggleTrackLock(): void {
  store.trackLock = !store.trackLock;
  setLockUI(store.trackLock);
  if (store.trackLock) {
    store.lastInteract = 0;
    store.camLL = null;
    store.flyingToTarget = false;
  }
}

export function wireTrackControls(): void {
  const badge = $<HTMLElement>('#tracking-badge');
  badge?.addEventListener('click', toggleTrackLock);
  // role="button" on a <div> needs manual Enter/Space activation (native
  // <button> elements get this for free).
  badge?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleTrackLock();
    }
  });
}
