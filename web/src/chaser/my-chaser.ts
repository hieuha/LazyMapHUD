// "My chaser" resolution — which live chaser this viewer treats as their own.
// The 1 km recovery ring and proximity warnings are computed from THIS chaser,
// so a 10-person chase team each sees the ring around their own device.
//
// Resolution order (see resolveMyChaser):
//   1. an explicit choice (store.myChaserId) that still exists in the live set
//   2. otherwise, when exactly one chaser is live, adopt it automatically
//   3. otherwise undefined — ring hidden until the viewer picks one
//
// The initial choice comes from `?me=<id>` on the HUD URL (best for a per-
// device bookmark) or a persisted previous choice in localStorage.
import type { EntityEngine, Chaser } from '../entities/entity-engine.js';
import { store } from '../state/store.js';

const LS_KEY = 'lazymap:me';

/** The chaser this viewer owns, or undefined when it can't be determined yet. */
export function resolveMyChaser(engine: EntityEngine): Chaser | undefined {
  if (store.myChaserId) {
    const chosen = engine.chasers.get(store.myChaserId);
    if (chosen) return chosen;
  }
  if (engine.chasers.size === 1) {
    return engine.chasers.values().next().value;
  }
  return undefined;
}

/** Set (or clear, with '') the viewer's own chaser and persist it for reloads. */
export function setMyChaser(id: string): void {
  store.myChaserId = id;
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* private-mode / storage disabled — selection just won't persist */
  }
}

/** Seed store.myChaserId at boot from `?me=` (wins) then localStorage. */
export function initMyChaserId(): void {
  let id = '';
  try {
    id = new URLSearchParams(window.location.search).get('me')?.trim() ?? '';
  } catch {
    /* no URL access — ignore */
  }
  if (!id) {
    try {
      id = localStorage.getItem(LS_KEY) ?? '';
    } catch {
      /* storage disabled — ignore */
    }
  }
  if (id) setMyChaser(id);
}
