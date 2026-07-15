// GET /history/:id — fetches recent track points for trail hydration (Phase 2's
// HistoryRepo, served independent of live TTL). Used when a target is selected
// so its rendered trail reflects the real flown path, not just points seen
// since the browser connected.
//
// Default is a same-origin RELATIVE path (not an absolute localhost:3000 URL):
// in dev, vite.config.ts proxies /history to the API so the browser fetch is
// same-origin (no CORS needed — the server has none); in production the
// planned topology (Phase 7: Caddy) serves web + API from the same origin
// too. Set VITE_API_URL only when the API truly lives on a different origin
// (the server would then need its own CORS headers — out of this phase).
function apiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : '';
}

export interface HistoryPoint {
  lat: number;
  lon: number;
  altitude_m: number;
  heading: number;
  speed_ms: number;
  climb_ms: number;
  ts: number;
}

interface HistoryResponse {
  id: string;
  points: HistoryPoint[];
}

function isHistoryPoint(v: unknown): v is HistoryPoint {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    typeof p.altitude_m === 'number' &&
    typeof p.heading === 'number' &&
    typeof p.speed_ms === 'number' &&
    typeof p.climb_ms === 'number' &&
    typeof p.ts === 'number'
  );
}

/**
 * Fetch history points for `id`, oldest-first. Returns `[]` on any network,
 * HTTP, or shape error — trail hydration is a nice-to-have, never blocking.
 */
export async function fetchHistory(id: string, opts: { since?: number; limit?: number } = {}): Promise<HistoryPoint[]> {
  try {
    const path = `${apiBase()}/history/${encodeURIComponent(id)}`;
    const url = new URL(path, window.location.origin);
    if (opts.since !== undefined) url.searchParams.set('since', String(opts.since));
    if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit));

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];

    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || !Array.isArray((body as HistoryResponse).points)) {
      return [];
    }
    return (body as HistoryResponse).points.filter(isHistoryPoint);
  } catch {
    return [];
  }
}
