// Ping/pong liveness check. Every interval, ping all clients that answered
// the previous ping and terminate any that went silent (dead/unresponsive
// sockets — e.g. network drop without a clean close).
import type { WebSocket } from 'ws';

const ALIVE = Symbol('alive');

interface TrackedSocket extends WebSocket {
  [ALIVE]?: boolean;
}

/** Mark a freshly-connected socket alive and wire its pong handler. */
export function trackHeartbeat(ws: WebSocket): void {
  const tracked = ws as TrackedSocket;
  tracked[ALIVE] = true;
  tracked.on('pong', () => {
    tracked[ALIVE] = true;
  });
}

/**
 * Ping every open socket in `clients`; terminate any that didn't pong since
 * the last sweep. Returns the terminated sockets so callers can drop them
 * from their own bookkeeping.
 */
export function sweepHeartbeat(clients: Iterable<WebSocket>): WebSocket[] {
  const terminated: WebSocket[] = [];
  for (const ws of clients) {
    const tracked = ws as TrackedSocket;
    if (tracked[ALIVE] === false) {
      terminated.push(ws);
      ws.terminate();
      continue;
    }
    tracked[ALIVE] = false;
    ws.ping();
  }
  return terminated;
}
