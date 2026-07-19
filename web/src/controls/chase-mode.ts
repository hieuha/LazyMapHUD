// Chase mode — unifies the old standalone chaser device page into the main HUD.
//
// Open the HUD with `?chase=<name>` and this device becomes a chaser: it reads
// its own GPS (navigator.geolocation.watchPosition) and POSTs fixes to the
// open /chaser endpoint as `<name>`, and adopts itself as the viewer's own
// chaser (so the 1 km recovery ring + proximity warnings track around it).
//
// Without `?chase=`, this is a no-op — the HUD is a pure viewer that observes
// every chaser on the map (and never prompts for location).
//
// The status chip atop the roster panel shows two independent signals:
//   GPS    — does the device have a location fix (and how accurate)
//   UPLINK — are fixes reaching the server (POST /chaser)
import { postChaserFix, leaveChaser } from '../net/chaser-post.js';
import { setMyChaser } from '../chaser/my-chaser.js';
import { store } from '../state/store.js';

const POST_INTERVAL_MS = 3000;

interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  altitude_m?: number;
  heading?: number;
  speed_ms?: number;
}

type DotState = 'on' | 'acq' | 'off';

/** Read `?chase=<name>` from the URL; empty/absent means viewer-only. */
function chaseName(): string {
  try {
    return new URLSearchParams(window.location.search).get('chase')?.trim() ?? '';
  } catch {
    return '';
  }
}

interface Chip {
  setGps(state: DotState, label: string): void;
  setTx(state: DotState, label: string): void;
}

/** Build the chase-status chip inside `#chase-chip` (styled to match the HUD
 * panel headers) and return setters for its two indicator lights. */
function buildChip(name: string): Chip {
  const root = document.getElementById('chase-chip');
  if (!root) return { setGps: () => {}, setTx: () => {} };
  root.hidden = false;
  const ind = (id: string, label: string): string =>
    `<span class="cc-ind"><i class="cc-dot" id="${id}"></i><span id="${id}-l">${label}</span></span>`;
  root.innerHTML =
    `<span class="cc-accent"></span>` +
    `<span class="cc-tag">Chase</span>` +
    `<span class="cc-name"></span>` +
    `<span class="cc-inds">${ind('cc-gps', 'GPS —')}${ind('cc-tx', 'STANDBY')}</span>`;
  const nameEl = root.querySelector<HTMLElement>('.cc-name');
  if (nameEl) nameEl.textContent = name; // textContent keeps the free-form name inert

  const set = (dotId: string, state: DotState, label: string): void => {
    const dot = document.getElementById(dotId);
    const lbl = document.getElementById(`${dotId}-l`);
    if (dot) dot.className = 'cc-dot ' + state;
    if (lbl) lbl.textContent = label;
  };
  return {
    setGps: (s, l) => set('cc-gps', s, l),
    setTx: (s, l) => set('cc-tx', s, l),
  };
}

/** Show + wire the LEAVE CHASE button: signal the server to drop this chaser
 * now (not after the ~2 min TTL), then reload as a pure viewer (which also
 * stops the GPS uplink). Only wired while in chase mode. */
function wireLeaveButton(name: string): void {
  const btn = document.getElementById('chase-leave-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    leaveChaser(name); // beacon the departure so viewers see it vanish immediately
    const url = new URL(window.location.href);
    url.searchParams.delete('chase');
    window.location.assign(url.toString()); // reload without ?chase= → viewer, uplink stops
  });
}

/** Activate chase mode if `?chase=<name>` is present; otherwise do nothing. */
export function wireChaseMode(): void {
  const name = chaseName();
  if (!name) return;

  // Track the viewer's own device so the ring/proximity center on it.
  store.isChaseMode = true;
  setMyChaser(name);
  wireLeaveButton(name);
  const chip = buildChip(name);

  if (!navigator.geolocation) {
    chip.setGps('off', 'NO GPS API');
    return;
  }
  if (!window.isSecureContext) {
    chip.setGps('off', 'NEEDS HTTPS');
    return;
  }

  let latest: Fix | null = null;
  let sending = false;

  const send = async (): Promise<void> => {
    if (!latest || sending) return;
    sending = true;
    const res = await postChaserFix({ id: name, name, ...latest });
    sending = false;
    if (res.ok) chip.setTx('on', 'UPLINK');
    else chip.setTx('off', 'UPLINK ERR');
  };

  chip.setGps('acq', 'ACQUIRING…');
  chip.setTx('acq', 'STANDBY');
  navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      latest = {
        lat: c.latitude,
        lon: c.longitude,
        accuracy: c.accuracy,
        altitude_m: c.altitude != null ? c.altitude : undefined,
        heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : undefined,
        speed_ms: c.speed != null && !Number.isNaN(c.speed) ? c.speed : undefined,
      };
      // Fix acquired — accuracy tells the operator how good it is.
      chip.setGps('on', `±${Math.round(c.accuracy)} M`);
      void send(); // post immediately on each fresh fix
    },
    (err) => {
      const why = err.code === err.PERMISSION_DENIED ? 'DENIED' : err.code === err.TIMEOUT ? 'TIMEOUT' : 'NO SIGNAL';
      chip.setGps('off', why);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
  );
  setInterval(() => void send(), POST_INTERVAL_MS);
}
