import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { Entity } from 'shared/entity';
import type { WireMessage } from 'shared/wire';
import { HistoryRepo } from '../src/store/history-repo.js';
import { EntityStore } from '../src/store/entity-store.js';
import { WsHub } from '../src/ws/hub.js';

const WS_PATH = '/ws';
const FLUSH_MS = 20; // short flush interval to keep tests fast

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'balloon-1',
    type: 'balloon',
    lat: 21.0285,
    lon: 105.8542,
    altitude_m: 1500,
    heading: 90,
    speed_ms: 5,
    climb_ms: 2,
    ts: Date.now(),
    ...overrides,
  };
}

/** Wait until `predicate` returns true or `timeoutMs` elapses. */
function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function connectClient(url: string): Promise<{ ws: WebSocket; messages: WireMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: WireMessage[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as WireMessage);
    });
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', reject);
  });
}

describe('WsHub', () => {
  let app: FastifyInstance;
  let repo: HistoryRepo;
  let store: EntityStore;
  let hub: WsHub;
  let baseUrl: string;

  beforeEach(async () => {
    repo = new HistoryRepo(':memory:');
    store = new EntityStore(repo);
    app = Fastify();
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected AddressInfo');
    baseUrl = `ws://127.0.0.1:${address.port}${WS_PATH}`;

    hub = new WsHub({ store, server: app.server, path: WS_PATH, flushIntervalMs: FLUSH_MS });
  });

  afterEach(async () => {
    await hub.close();
    await app.close();
    store.stopSweep();
    repo.close();
    vi.useRealTimers();
  });

  it('sends a snapshot of current live entities on connect', async () => {
    store.upsert(makeEntity({ id: 'a' }));
    store.upsert(makeEntity({ id: 'b' }));

    const { ws, messages } = await connectClient(baseUrl);
    await waitFor(() => messages.length >= 1);

    const snapshot = messages[0];
    expect(snapshot?.type).toBe('snapshot');
    if (snapshot?.type === 'snapshot') {
      expect(snapshot.entities.map((e) => e.id).sort()).toEqual(['a', 'b']);
      expect(snapshot.serverTs).toBeTypeOf('number');
    }
    ws.close();
  });

  it('broadcasts store upserts as a batched delta within one flush window', async () => {
    const { ws, messages } = await connectClient(baseUrl);
    await waitFor(() => messages.length >= 1); // snapshot

    store.upsert(makeEntity({ id: 'c' }));

    await waitFor(() => messages.length >= 2);
    const delta = messages[1];
    expect(delta?.type).toBe('upsert');
    if (delta?.type === 'upsert') {
      expect(delta.entities).toHaveLength(1);
      expect(delta.entities[0]?.id).toBe('c');
    }
    ws.close();
  });

  it('broadcasts store removes as a batched delta', async () => {
    store.upsert(makeEntity({ id: 'd' }));
    const { ws, messages } = await connectClient(baseUrl);
    await waitFor(() => messages.length >= 1); // snapshot

    // Simulate a removal the way EntityStore does internally (TTL sweep /
    // max-live eviction both emit 'remove' with just the id).
    store.emit('remove', 'd');

    await waitFor(() => messages.length >= 2);
    const delta = messages[1];
    expect(delta?.type).toBe('remove');
    if (delta?.type === 'remove') {
      expect(delta.id).toBe('d');
    }
    ws.close();
  });

  it('coalesces multiple rapid upserts for the same id into a single delta message', async () => {
    const { ws, messages } = await connectClient(baseUrl);
    await waitFor(() => messages.length >= 1); // snapshot

    store.upsert(makeEntity({ id: 'e', lat: 1 }));
    store.upsert(makeEntity({ id: 'e', lat: 2 }));
    store.upsert(makeEntity({ id: 'e', lat: 3 }));

    // Give it a couple of flush windows to prove no extra messages ever land.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS * 3));

    const deltas = messages.slice(1).filter((m) => m.type === 'upsert');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.type).toBe('upsert');
    if (deltas[0]?.type === 'upsert') {
      expect(deltas[0].entities).toHaveLength(1);
      expect(deltas[0].entities[0]?.lat).toBe(3); // latest value wins
    }
    ws.close();
  });

  it('ignores inbound client messages — no entity mutation over WS', async () => {
    const { ws } = await connectClient(baseUrl);

    ws.send(
      JSON.stringify({
        type: 'upsert',
        entities: [makeEntity({ id: 'hacker-injected' })],
        serverTs: Date.now(),
      }),
    );

    // Give the server a moment to (not) process it.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS * 2));

    expect(store.get('hacker-injected')).toBeUndefined();
    ws.close();
  });

  it('prunes dead sockets via the heartbeat sweep', async () => {
    // Replace the beforeEach hub with one on a short heartbeat interval —
    // only one WsHub may own a given (server, path) upgrade handler at a time.
    await hub.close();
    const heartbeatMs = 30;
    const hub2 = new WsHub({
      store,
      server: app.server,
      path: WS_PATH,
      flushIntervalMs: FLUSH_MS,
      heartbeatIntervalMs: heartbeatMs,
    });

    try {
      const { ws: clientWs } = await connectClient(baseUrl);
      const serverClients = (hub2 as unknown as { wss: { clients: Set<WebSocket> } }).wss.clients;
      await waitFor(() => serverClients.size >= 1);
      const serverSideSocket = [...serverClients][0];
      if (!serverSideSocket) throw new Error('expected a server-side socket');

      // Stop responding to pings — simulate a dead/unresponsive client by
      // disabling its automatic pong response, so the *server-side* socket
      // never receives a pong and gets pruned by the heartbeat sweep.
      clientWs.pong = () => {};

      const terminateSpy = vi.spyOn(serverSideSocket, 'terminate');

      // Two heartbeat cycles: first ping marks not-yet-ponged, second sweep
      // finds it still unanswered and terminates it.
      await new Promise((resolve) => setTimeout(resolve, heartbeatMs * 2 + 20));
      await new Promise((resolve) => setTimeout(resolve, heartbeatMs * 2 + 20));

      expect(terminateSpy).toHaveBeenCalled();
    } finally {
      await hub2.close();
    }
  });
});
