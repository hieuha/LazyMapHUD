// Generic source adapter: the webhook body is already (almost) canonical
// JSON matching the Entity shape. Fills in `ts` with server-receive time
// when the source omits it; all other fields must be present and are
// validated by the caller via `EntitySchema`.
import type { Adapter } from '../adapter-registry.js';

export const genericAdapter: Adapter = {
  name: 'generic',
  toEntity(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) {
      return body;
    }
    const record = body as Record<string, unknown>;
    if (record.ts !== undefined) {
      return record;
    }
    return { ...record, ts: Date.now() };
  },
};
