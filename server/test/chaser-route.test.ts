import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HistoryRepo } from '../src/store/history-repo.js';
import { EntityStore } from '../src/store/entity-store.js';
import { registerChaserRoute } from '../src/http/chaser-route.js';

describe('POST /chaser', () => {
  let app: FastifyInstance;
  let repo: HistoryRepo;
  let store: EntityStore;

  beforeEach(() => {
    repo = new HistoryRepo(':memory:');
    store = new EntityStore(repo);
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
    store.stopSweep();
    repo.close();
  });

  it('accepts a minimal valid payload (no auth) and upserts a chaser entity', async () => {
    registerChaserRoute(app, { store });

    const res = await app.inject({
      method: 'POST',
      url: '/chaser',
      payload: { id: 'chase-1', lat: 21.02, lon: 105.8 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: 'chase-1' });

    const stored = store.get('chase-1');
    expect(stored).toMatchObject({
      id: 'chase-1',
      type: 'chaser',
      lat: 21.02,
      lon: 105.8,
      altitude_m: 0,
      heading: 0,
      speed_ms: 0,
      climb_ms: 0,
    });
    expect(stored?.ts).toBeTypeOf('number');
  });

  it('accepts optional altitude/heading/speed/meta fields', async () => {
    registerChaserRoute(app, { store });

    const res = await app.inject({
      method: 'POST',
      url: '/chaser',
      payload: {
        id: 'chase-2',
        lat: 21,
        lon: 105,
        altitude_m: 12,
        heading: 90,
        speed_ms: 3,
        meta: { device: 'ipad-1' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(store.get('chase-2')).toMatchObject({
      altitude_m: 12,
      heading: 90,
      speed_ms: 3,
      meta: { device: 'ipad-1' },
    });
  });

  it('rejects a payload missing lat/lon with 400', async () => {
    registerChaserRoute(app, { store });

    const res = await app.inject({
      method: 'POST',
      url: '/chaser',
      payload: { id: 'chase-3' },
    });

    expect(res.statusCode).toBe(400);
    expect(store.get('chase-3')).toBeUndefined();
  });

  it('rejects out-of-range lat/lon with 400', async () => {
    registerChaserRoute(app, { store });

    const res = await app.inject({
      method: 'POST',
      url: '/chaser',
      payload: { id: 'chase-4', lat: 999, lon: 105 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rate-limits repeated requests from the same IP', async () => {
    registerChaserRoute(app, { store, maxPerSecond: 2 });

    const post = () =>
      app.inject({
        method: 'POST',
        url: '/chaser',
        payload: { id: 'chase-rl', lat: 21, lon: 105 },
      });

    const results = await Promise.all([post(), post(), post(), post()]);
    const statuses = results.map((r) => r.statusCode);

    expect(statuses.filter((s) => s === 200).length).toBe(2);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
  });
});
