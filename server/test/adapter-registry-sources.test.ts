// Verifies `POST /webhook?source=sondehub|adsb` routes external payloads
// through the same field mapping the pollers use (adapter-registry wiring).
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

describe('POST /webhook?source=sondehub|adsb', () => {
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

  it('maps a raw SondeHub frame posted with ?source=sondehub', async () => {
    const payload = {
      serial: 'Y0322352',
      datetime: '2026-07-15T12:00:00.000Z',
      lat: 21.0,
      lon: 105.8,
      alt: 500,
      vel_v: 5,
      vel_h: 8,
      heading: 90,
      frame: 42,
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook?source=sondehub',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const entity = store.get('sonde-Y0322352');
    expect(entity).toBeDefined();
    expect(entity?.type).toBe('balloon');
    expect(entity?.altitude_m).toBe(500);
  });

  it('maps a raw ADS-B aircraft record posted with ?source=adsb', async () => {
    const payload = {
      hex: 'a1b2c3',
      lat: 37.615,
      lon: -122.389,
      alt_baro: 35000,
      gs: 480,
      track: 270,
      baro_rate: 0,
    };
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook?source=adsb',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const entity = store.get('adsb-a1b2c3');
    expect(entity).toBeDefined();
    expect(entity?.type).toBe('aircraft');
    expect(entity?.altitude_m).toBeCloseTo(35000 * 0.3048, 3);
  });

  it('rejects an unmappable sondehub payload with 400 (no valid frame)', async () => {
    const payload = { serial: 'Y0322352' }; // missing required fields
    const body = JSON.stringify(payload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhook?source=sondehub',
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });
});
