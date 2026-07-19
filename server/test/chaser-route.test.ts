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
      name: 'chase-1', // defaults to id when no name is sent
      type: 'chaser',
      lat: 21.02,
      lon: 105.8,
      altitude_m: 0,
    });
    // Bare fix with no motion -> no meta at all.
    expect(stored?.meta).toBeUndefined();
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
    // Device still sends flat heading/speed; they're folded into meta alongside
    // whatever the caller put in meta explicitly.
    expect(store.get('chase-2')).toMatchObject({
      altitude_m: 12,
      meta: { device: 'ipad-1', heading: 90, speed_ms: 3 },
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

  it('rejects an id with selector-breaking characters with 400 (nothing stored)', async () => {
    registerChaserRoute(app, { store });

    // `a"]` would break `.row[data-id="…"]` selector interpolation on the client.
    const res = await app.inject({
      method: 'POST',
      url: '/chaser',
      payload: { id: 'a"]', lat: 21, lon: 105 },
    });

    expect(res.statusCode).toBe(400);
    expect(store.get('a"]')).toBeUndefined();
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

  it('POST /chaser/leave drops a live chaser immediately', async () => {
    registerChaserRoute(app, { store });

    await app.inject({ method: 'POST', url: '/chaser', payload: { id: 'chase-9', lat: 21, lon: 105 } });
    expect(store.get('chase-9')).toBeDefined();

    const res = await app.inject({ method: 'POST', url: '/chaser/leave', payload: { id: 'chase-9' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, removed: true });
    expect(store.get('chase-9')).toBeUndefined();
  });

  it('POST /chaser/leave refuses to drop a non-chaser entity (403)', async () => {
    registerChaserRoute(app, { store });

    // A sonde must not be removable via the open chaser-leave endpoint.
    store.upsert({ id: 'sonde-x', name: 'sonde-x', type: 'balloon', lat: 21, lon: 105, altitude_m: 1000, ts: Date.now() });

    const res = await app.inject({ method: 'POST', url: '/chaser/leave', payload: { id: 'sonde-x' } });

    expect(res.statusCode).toBe(403);
    expect(store.get('sonde-x')).toBeDefined();
  });
});
