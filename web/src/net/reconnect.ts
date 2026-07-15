// Generic exponential-backoff + jitter reconnect wrapper. Framework-agnostic:
// callers hand it a `connect()` factory that returns a "live" handle (a
// WebSocket here, but this module never imports `ws`/DOM WebSocket types) plus
// hooks to wire that handle's open/close/error events back into the loop. This
// keeps ws-source.ts focused on wire decoding while reconnect.ts owns timing.

export type ReconnectStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ReconnectOptions<T> {
  /** Create + return a new connection attempt (e.g. `new WebSocket(url)`). */
  connect: () => T;
  /** Wire the handle's open event; call `onOpen` when the connection is live. */
  bindOpen: (handle: T, onOpen: () => void) => void;
  /** Wire the handle's close/error events; call `onDown` exactly once per handle. */
  bindDown: (handle: T, onDown: () => void) => void;
  /** Tear down a handle (e.g. `.close()`) — used when stop() is called mid-attempt. */
  teardown: (handle: T) => void;
  /** Base delay in ms before the first retry (default 500). */
  baseDelayMs?: number;
  /** Cap on the backoff delay (default 15000). */
  maxDelayMs?: number;
  /** Status change notifications (connecting/open/reconnecting/closed). */
  onStatus?: (status: ReconnectStatus) => void;
}

/**
 * Owns the retry loop: connect -> (open | down) -> backoff -> connect...
 * `start()` begins the first attempt; `stop()` halts retries and tears down
 * any live/in-flight handle. Safe to call `stop()` multiple times.
 */
export class Reconnector<T> {
  private handle: T | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly opts: ReconnectOptions<T>) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connectNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.handle !== null) {
      this.opts.teardown(this.handle);
      this.handle = null;
    }
    this.opts.onStatus?.('closed');
  }

  /** Current live handle, or null while connecting/backing off. */
  get current(): T | null {
    return this.handle;
  }

  private connectNow(): void {
    if (this.stopped) return;
    this.opts.onStatus?.(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const handle = this.opts.connect();
    this.handle = handle;

    this.opts.bindOpen(handle, () => {
      if (this.stopped || this.handle !== handle) return;
      this.attempt = 0;
      this.opts.onStatus?.('open');
    });

    this.opts.bindDown(handle, () => {
      if (this.stopped || this.handle !== handle) return;
      this.handle = null;
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.opts.onStatus?.('reconnecting');
    const base = this.opts.baseDelayMs ?? 500;
    const max = this.opts.maxDelayMs ?? 15000;
    const exp = Math.min(max, base * 2 ** this.attempt);
    const jitter = exp * (0.5 + Math.random() * 0.5); // 50%-100% of the exponential ceiling
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connectNow();
    }, jitter);
  }
}
