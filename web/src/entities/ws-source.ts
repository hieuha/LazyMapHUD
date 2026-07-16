// WebSocketSource: the sole live EntitySource. Connects to the hub
// (`VITE_WS_URL`), decodes WireMessages, and applies them to the EntityEngine —
// read-only (no upstream writes, D4). Reconnects with backoff via
// `Reconnector`; status changes are reported to the caller so `main.ts` can
// drive the connection pill.
import type { EntityEngine } from './entity-engine.js';
import type { EntitySource, EntitySourceHandlers } from './entity-source.js';
import { Reconnector, type ReconnectStatus } from '../net/reconnect.js';
import { decodeWireMessage } from '../net/wire-decode.js';

function wsUrl(): string {
  // Explicit override wins (e.g. cross-origin API).
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  // Otherwise derive a SAME-ORIGIN WebSocket URL from the current page: wss://
  // on an https page (production behind Caddy), ws:// otherwise (dev, where
  // Vite proxies /ws to the API). This makes the production build work on any
  // domain with no build-time env var.
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return 'ws://localhost:3000/ws';
}

export class WebSocketSource implements EntitySource {
  private readonly reconnector: Reconnector<WebSocket>;
  private handlers: EntitySourceHandlers | null = null;

  constructor(
    readonly engine: EntityEngine,
    private readonly onStatus?: (status: ReconnectStatus) => void,
    private readonly url: string = wsUrl(),
  ) {
    this.reconnector = new Reconnector<WebSocket>({
      connect: () => this.openSocket(),
      bindOpen: (ws, onOpen) => ws.addEventListener('open', onOpen),
      bindDown: (ws, onDown) => {
        ws.addEventListener('close', onDown);
        ws.addEventListener('error', onDown);
      },
      teardown: (ws) => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      },
      onStatus: (status) => this.onStatus?.(status),
    });
  }

  private openSocket(): WebSocket {
    const ws = new WebSocket(this.url);
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    return ws;
  }

  private onMessage(raw: unknown): void {
    // Guards a close()/stop() race: a message already in-flight when the
    // socket is torn down must not mutate engine state after this source has
    // been stopped.
    if (!this.handlers) return;
    const result = decodeWireMessage(raw);
    if (!result.ok) {
      // Malformed/unexpected frame — drop it silently; the hub only ever
      // sends validated WireMessages, so this guards against protocol drift.
      return;
    }
    const msg = result.message;
    if (msg.type === 'snapshot') {
      this.engine.applySnapshot(msg.entities);
      this.handlers?.onSnapshot(this.engine.entities);
    } else if (msg.type === 'upsert') {
      msg.entities.forEach((e) => {
        this.engine.applyUpsert(e);
        // Chaser-type entities route into `engine.chaser`, not the roster —
        // only notify onUpsert for entities that actually landed in `entities`.
        const hud = this.engine.entities.find((h) => h.id === e.id);
        if (hud) this.handlers?.onUpsert(hud);
      });
    } else {
      this.engine.applyRemove(msg.id);
      this.handlers?.onRemove(msg.id);
    }
  }

  start(handlers: EntitySourceHandlers): void {
    this.handlers = handlers;
    this.reconnector.start();
  }

  /** Live entities move purely from WS pushes; interpolation runs inside the
   * render loop reading `entities[].cur` directly, so tick() is a no-op here. */
  tick(_dt: number): void {
    /* no-op: WS pushes drive position, not the animation clock */
  }

  stop(): void {
    this.reconnector.stop();
    this.handlers = null;
  }
}
