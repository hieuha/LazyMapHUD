// Generic source adapter: the webhook body is flat JSON. Only the required
// core fields (name, type, lat, lon, altitude_m) must be present; `id` and
// `ts` are filled when omitted, and every other field the sender includes
// (heading, speed_ms, callsign, freq_mhz, …) is auto-bucketed into `meta`.
// The caller validates the result via `EntitySchema`.
import type { Adapter } from '../adapter-registry.js';
import { normalizeToEntity } from 'shared/entity';

export const genericAdapter: Adapter = {
  name: 'generic',
  toEntity(body: unknown): unknown {
    return normalizeToEntity(body, Date.now());
  },
};
