// Validates raw WebSocket frames against the shared WireMessage contract
// before anything touches the entity engine. Reuses `shared`'s zod schema
// (single source of truth with the server) instead of hand-rolled checks.
import { WireMessageSchema, type WireMessage } from 'shared';

export type DecodeResult =
  | { ok: true; message: WireMessage }
  | { ok: false; reason: string };

/** Parse + validate a raw WS `event.data` payload (expected to be a JSON string). */
export function decodeWireMessage(raw: unknown): DecodeResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'non-string frame' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }

  const result = WireMessageSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, message: result.data };
}
