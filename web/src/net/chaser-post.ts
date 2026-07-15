// POST client for the Chaser-mode device page (D6): pushes this device's own
// GPS fix to the open `/chaser` endpoint. Mirrors history-client.ts's
// same-origin-by-default convention (VITE_API_URL only when the API truly
// lives on a different origin — dev proxy handles same-origin locally).
export interface ChaserFix {
  id: string;
  lat: number;
  lon: number;
  altitude_m?: number;
  heading?: number;
  speed_ms?: number;
}

function apiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : '';
}

export type PostResult = { ok: true } | { ok: false; reason: string };

/** POST one GPS fix to /chaser. Never throws — network/HTTP errors surface as `{ok:false}`. */
export async function postChaserFix(fix: ChaserFix): Promise<PostResult> {
  try {
    const res = await fetch(`${apiBase()}/chaser`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fix),
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'network error' };
  }
}
