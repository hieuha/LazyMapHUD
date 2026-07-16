import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { HistoryRepo } from '../src/store/history-repo.js';
import { EntityStore } from '../src/store/entity-store.js';
import { registerWebhookRoute } from '../src/http/webhook-route.js';

const SECRET = 'test-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

describe('POST /webhook', () => {
  let app: FastifyInstance;
  let repo: HistoryRepo;
  let store: EntityStore;

  beforeEach(() => {
    repo = new HistoryRepo(':memory:');
    store = new EntityStore(repo);
    app = Fastify();
    registerWebhookRoute(app, { store, webhookSecret: SECRET });
  });

  afterEach(async () => {
    await app.close();
    store.stopSweep();
    repo.close();
  });

  it('accepts a validly-signed canonical entity and upserts it', async () => {
    const payload = {
      id: 'chaser-1',
      name: 'Chase Lead',
      type: 'chaser',
      lat: 21.0285,
      lon: 105.8542,
      altitude_m: 10,
      ts: Date.now(),
      meta: { heading: 45, speed_ms: 3, climb_ms: 0 },
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'chaser-1' });
    expect(store.get('chaser-1')).toEqual(payload);
  });

  it('defaults ts to server receive time when omitted', async () => {
    // Flat payload, no ts: server fills ts, and the non-core `speed_ms` field
    // is auto-bucketed into meta.
    const payload = {
      id: 'balloon-2',
      name: 'Balloon Two',
      type: 'balloon',
      lat: 21,
      lon: 105,
      altitude_m: 500,
      speed_ms: 1,
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const stored = store.get('balloon-2');
    expect(stored?.ts).toBeTypeOf('number');
    expect(stored?.meta).toEqual({ speed_ms: 1 });
  });

  it('rejects a missing signature with 401', async () => {
    const body = JSON.stringify({ id: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong signature with 401', async () => {
    const body = JSON.stringify({ id: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'deadbeef'.repeat(8),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(store.get('x')).toBeUndefined();
  });

  it('rejects malformed JSON with 400', async () => {
    const body = '{not-json';
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts and persists meta, and it round-trips through the store', async () => {
    const payload = {
      id: 'balloon-meta-1',
      name: 'VN123 sonde',
      type: 'balloon',
      lat: 21.0285,
      lon: 105.8542,
      altitude_m: 500,
      ts: Date.now(),
      meta: { callsign: 'VN123', freq_mhz: 403, battery_v: 3.1 },
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(store.get('balloon-meta-1')?.meta).toEqual({
      callsign: 'VN123',
      freq_mhz: 403,
      battery_v: 3.1,
    });
  });

  it('rejects meta over the key-count cap with 400', async () => {
    const meta: Record<string, number> = {};
    for (let i = 0; i < 65; i++) meta[`k${i}`] = i;
    const payload = {
      id: 'balloon-meta-2',
      name: 'Balloon Meta Two',
      type: 'balloon',
      lat: 21,
      lon: 105,
      altitude_m: 500,
      ts: Date.now(),
      meta,
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(store.get('balloon-meta-2')).toBeUndefined();
  });

  it('rejects meta over the serialized byte-size cap with 400', async () => {
    const payload = {
      id: 'balloon-meta-3',
      name: 'Balloon Meta Three',
      type: 'balloon',
      lat: 21,
      lon: 105,
      altitude_m: 500,
      ts: Date.now(),
      meta: { blob: 'x'.repeat(5000) },
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(store.get('balloon-meta-3')).toBeUndefined();
  });

  it('rejects a validly-signed but schema-invalid entity with 400', async () => {
    const payload = { id: 'bad-1', type: 'balloon', lat: 999, lon: 105 };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(store.get('bad-1')).toBeUndefined();
  });

  it('rejects a body over the 64KB size cap with 413, even when signed correctly', async () => {
    const payload = {
      id: 'too-big',
      type: 'balloon',
      lat: 21,
      lon: 105,
      altitude_m: 500,
      heading: 0,
      speed_ms: 1,
      climb_ms: 1,
      ts: Date.now(),
      meta: { blob: 'x'.repeat(70 * 1024) },
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
    expect(store.get('too-big')).toBeUndefined();
  });

  it('rate-limits repeated requests from the same IP (per-IP, in front of HMAC)', async () => {
    const rlApp = Fastify();
    registerWebhookRoute(rlApp, { store, webhookSecret: SECRET, maxPerSecond: 2 });

    const post = () => {
      const body = JSON.stringify({ id: 'rl-x' });
      return rlApp.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
        payload: body,
      });
    };

    const results = await Promise.all([post(), post(), post(), post()]);
    const statuses = results.map((r) => r.statusCode);

    expect(statuses.filter((s) => s === 429).length).toBe(2);
    // The remaining 2 requests pass the rate limiter but fail schema validation
    // (payload only has `id`), proving rate-limiting runs independently of HMAC/schema checks.
    expect(statuses.filter((s) => s === 400).length).toBe(2);

    await rlApp.close();
  });
});
