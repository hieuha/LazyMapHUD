// WebSocket hub — server->browser entity broadcast (plan decision D4: no
// inbound entity writes over WS; the HMAC POST /webhook is the single
// ingest trust boundary). Attaches a `ws` server to the existing Fastify
// HTTP server, sends a full snapshot on connect, then coalesces store
// 'upsert'/'remove' events into batched deltas flushed on a fixed timer.
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Entity } from 'shared/entity';
import type { WireMessage } from 'shared/wire';
import type { EntityStore } from '../store/entity-store.js';
import { DeltaBuffer } from './delta-buffer.js';
import { trackHeartbeat, sweepHeartbeat } from './heartbeat.js';

const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface WsHubOptions {
  store: EntityStore;
  server: HttpServer;
  path?: string;
  flushIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

/**
 * Owns the `ws` server, buffered broadcast, and heartbeat sweep. Call
 * `close()` on shutdown to stop timers and terminate the ws server cleanly.
 */
export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly store: EntityStore;
  private readonly buffer = new DeltaBuffer();
  private flushTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private closed = false;

  private readonly onUpsert = (entity: Entity): void => {
    this.buffer.upsert(entity);
  };
  private readonly onRemove = (id: string): void => {
    this.buffer.remove(id);
  };

  constructor(options: WsHubOptions) {
    this.store = options.store;
    this.wss = new WebSocketServer({
      server: options.server,
      path: options.path ?? '/ws',
    });

    this.wss.on('connection', (ws) => this.handleConnection(ws));

    this.store.on('upsert', this.onUpsert);
    this.store.on('remove', this.onRemove);

    const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushTimer = setInterval(() => this.flush(), flushIntervalMs);
    this.flushTimer.unref?.();

    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => sweepHeartbeat(this.wss.clients), heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private handleConnection(ws: WebSocket): void {
    trackHeartbeat(ws);

    const snapshot: WireMessage = {
      type: 'snapshot',
      entities: this.store.snapshot(),
      serverTs: Date.now(),
    };
    send(ws, snapshot);

    // Inbound messages are ignored — WS is read-only for clients (D4). The
    // heartbeat 'pong' handler is wired separately in trackHeartbeat(); any
    // other inbound frame (including attempted entity writes) is a no-op.
    ws.on('message', () => {
      /* no inbound entity mutation path — see module header */
    });
  }

  /** Flush buffered store changes to all live clients as batched deltas. */
  private flush(): void {
    if (this.buffer.isEmpty) return;

    const { upserts, removes } = this.buffer.drain();
    const serverTs = Date.now();

    if (upserts.length > 0) {
      this.broadcast({ type: 'upsert', entities: upserts, serverTs });
    }
    for (const id of removes) {
      this.broadcast({ type: 'remove', id, serverTs });
    }
  }

  private broadcast(message: WireMessage): void {
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) continue;
      send(ws, message);
    }
  }

  /**
   * Stop timers, unsubscribe from the store, and close all sockets/the ws
   * server. Idempotent — safe to call more than once (e.g. overlapping
   * shutdown signals).
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.store.off('upsert', this.onUpsert);
    this.store.off('remove', this.onRemove);

    for (const ws of this.wss.clients) {
      ws.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function send(ws: WebSocket, message: WireMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}
