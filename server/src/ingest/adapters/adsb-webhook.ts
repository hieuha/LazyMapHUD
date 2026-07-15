// Webhook-side ADS-B adapter: lets an external sender POST a single
// `aircraft.json`-shaped payload to `/webhook?source=adsb` and have it
// routed through the same field mapping used for polling a local
// dump1090/tar1090 instance. Reuses `mapAdsbAircraft` for a single source of
// mapping truth. Only meaningful when ENABLE_ADSB is set (see index.ts) but
// the adapter itself is always registered so the route works regardless.
import type { Adapter } from '../adapter-registry.js';
import { mapAdsbAircraft } from '../../adapters/adsb.js';

export const adsbWebhookAdapter: Adapter = {
  name: 'adsb',
  toEntity(body: unknown): unknown {
    // A webhook sender may POST either a single aircraft record or the full
    // `{ aircraft: [...] }` payload shape; normalize to the latter.
    const payload =
      typeof body === 'object' && body !== null && 'aircraft' in body
        ? body
        : { aircraft: [body] };
    const entities = mapAdsbAircraft(payload);
    return entities[0] ?? {};
  },
};
