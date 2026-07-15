// Webhook-side SondeHub adapter: lets an external sender POST a single raw
// SondeHub frame (or an array of frames) to `/webhook?source=sondehub` and
// have it routed through the same field mapping the poller uses. Reuses
// `mapSondehubFrames` so the mapping logic lives in one place.
import type { Adapter } from '../adapter-registry.js';
import { mapSondehubFrames } from '../../adapters/sondehub.js';

export const sondehubWebhookAdapter: Adapter = {
  name: 'sondehub',
  toEntity(body: unknown): unknown {
    const frames = Array.isArray(body) ? body : [body];
    const entities = mapSondehubFrames(frames);
    // Webhook route expects a single candidate object; the schema validator
    // rejects it if mapping failed (empty result -> undefined -> {}).
    return entities[0] ?? {};
  },
};
