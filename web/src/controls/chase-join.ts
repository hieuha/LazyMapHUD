// Join-chase control — a topbar button that opens a modal to enter a chaser
// callsign, then activates chase mode by reloading with `?chase=<name>`.
//
// This is a convenience shortcut for the URL contract that chase-mode.ts reads
// (`?chase=<name>`): rather than hand-editing the URL, the operator clicks
// JOIN CHASE, types a callsign, and the page reloads into chase mode (GPS
// uplink). Reloading — instead of activating in place — reuses the existing
// startup path in wireChaseMode() verbatim, so there's one code path for
// "become a chaser" and no duplicated GPS/uplink wiring.
import { $ } from '../hud/format.js';

/** Matches the chaser id/name constraint the server enforces (min 1 char). */
const MAX_LEN = 32;
/** Callsigns are alphanumeric with spaces/dash/underscore/dot (e.g. Team1,
 * xv5hp, Y0342819). Restricting the charset keeps the id — which becomes an
 * entity id/name broadcast to every viewer — free of characters that could
 * break DOM/CSS-selector interpolation downstream. */
const CALLSIGN_RE = /^[A-Za-z0-9 ._-]+$/;

/** True when the HUD is already in chase mode (`?chase=` present). */
function alreadyChasing(): boolean {
  try {
    return !!new URLSearchParams(window.location.search).get('chase')?.trim();
  } catch {
    return false;
  }
}

/**
 * Wire the JOIN CHASE button + modal. No-op (and the button stays hidden)
 * when this HUD is already a chaser — the chase-status chip covers that state,
 * so the join control would be redundant.
 */
export function wireChaseJoin(): void {
  const btn = $<HTMLButtonElement>('#chase-join-btn');
  const modal = $<HTMLDialogElement>('#chase-modal');
  const form = $<HTMLFormElement>('#chase-form');
  const input = $<HTMLInputElement>('#chase-input');
  const cancel = $<HTMLButtonElement>('#chase-cancel');
  const err = $<HTMLElement>('#chase-err');
  if (!btn || !modal || !form || !input) return;

  if (alreadyChasing()) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;

  const showErr = (msg: string): void => {
    if (err) {
      err.textContent = msg;
      err.hidden = false;
    }
  };
  const clearErr = (): void => {
    if (err) err.hidden = true;
  };

  const open = (): void => {
    clearErr();
    input.value = '';
    // Native modal gives backdrop + ESC-to-close + focus trap for free; fall
    // back to the non-modal `open` attribute on the rare browser without it.
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    input.focus();
  };
  const close = (): void => {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  };

  btn.addEventListener('click', open);
  cancel?.addEventListener('click', close);
  // Click on the backdrop (the dialog element itself, outside the form) closes.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) {
      showErr('Callsign is required.');
      input.focus();
      return;
    }
    if (name.length > MAX_LEN) {
      showErr(`Callsign must be ${MAX_LEN} characters or fewer.`);
      input.focus();
      return;
    }
    if (!CALLSIGN_RE.test(name)) {
      showErr('Use letters, numbers, spaces, . _ - only.');
      input.focus();
      return;
    }
    // Preserve any existing params (e.g. ?me=) and set ?chase=<name>.
    // searchParams.set encodes the value; reloading re-enters wireChaseMode().
    const url = new URL(window.location.href);
    url.searchParams.set('chase', name);
    window.location.assign(url.toString());
  });
}
