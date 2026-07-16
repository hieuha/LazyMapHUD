// Central mutable HUD state. In the mockup this lived in the IIFE closure; here
// it is a shared singleton so extracted modules can read/write the same flags
// (units/tz, selection, track-lock, follow-cam bookkeeping) without prop drilling.
import type { UnitSystem } from 'shared';

export type Timezone = 'utc' | 'local';

export interface HudState {
  units: UnitSystem; // "metric" | "imperial" (default metric — user in Vietnam)
  tz: Timezone; // default UTC (SondeHub is UTC)
  selectedId: string;
  /** id of the chaser this viewer treats as their own — drives the 1km ring +
   * proximity warnings. '' = auto (adopt the only chaser when exactly one exists). */
  myChaserId: string;
  /** true when the HUD was opened with ?chase=<name> (this device is a chaser). */
  isChaseMode: boolean;
  /** chaser id the follow-cam is bound to (takes precedence over selectedId); '' = none. */
  followChaserId: string;

  // follow-cam (TRACK LOCK)
  trackLock: boolean; // follow-cam ON by default (auto-pan, no click needed)
  lastInteract: number; // ms of last GENUINE user drag/zoom/wheel (suspends follow)
  camLL: { lat: number; lng: number } | null; // smoothed tracking-camera center
  isProgrammaticMove: boolean; // true while OUR code moves the camera
  flyingToTarget: boolean; // true during a click-to-track flyTo
}

/** ~0.45 s follow smoothing / 8 s manual-drag suspend, ported verbatim. */
export const FOLLOW_SUSPEND = 8000;

export const store: HudState = {
  units: 'metric',
  tz: 'utc',
  selectedId: '',
  myChaserId: '',
  isChaseMode: false,
  followChaserId: '',
  trackLock: true,
  lastInteract: 0,
  camLL: null,
  isProgrammaticMove: false,
  flyingToTarget: false,
};

export const REDUCED =
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
