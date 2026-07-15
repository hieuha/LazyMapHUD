// Registry of source adapters keyed by name. Selected via `?source=` query
// param or a `source` field in the body; defaults to the generic adapter.
import { genericAdapter } from './adapters/generic.js';
import { sondehubWebhookAdapter } from './adapters/sondehub-webhook.js';
import { adsbWebhookAdapter } from './adapters/adsb-webhook.js';

export interface Adapter {
  name: string;
  /** Map a raw source payload to a (not-yet-validated) canonical Entity-shaped object. */
  toEntity(body: unknown): unknown;
}

const adapters = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  adapters.set(adapter.name, adapter);
}

/**
 * Resolve the adapter for a request: explicit `source` query/body wins,
 * falling back to 'generic' when unspecified or unknown.
 */
export function resolveAdapter(source: string | undefined): Adapter {
  if (source) {
    const adapter = adapters.get(source);
    if (adapter) return adapter;
  }
  return adapters.get('generic')!;
}

registerAdapter(genericAdapter);
registerAdapter(sondehubWebhookAdapter);
registerAdapter(adsbWebhookAdapter);
