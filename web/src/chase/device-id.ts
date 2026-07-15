// Stable per-device chaser id: `?id=` query param wins if present (lets an
// operator assign a fixed id, e.g. "chase-lead"); otherwise generate once and
// persist in localStorage so repeat visits from the same device keep the
// same id (matches D6: "chaser id stable per device").
const STORAGE_KEY = 'lazymap-chaser-id';

function randomId(): string {
  const rand = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `chaser-${rand}`;
}

export function resolveDeviceId(location: Pick<Location, 'search'> = window.location): string {
  const fromQuery = new URLSearchParams(location.search).get('id');
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;

  const generated = randomId();
  window.localStorage.setItem(STORAGE_KEY, generated);
  return generated;
}
