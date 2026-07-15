// Generic interval poller: repeatedly calls a fetch function and forwards
// whatever entities it resolves to a callback. Tolerates errors from the
// fetch fn (logs + continues, never throws out of the loop) and backs off
// with jitter after consecutive failures so a flaky/unreachable upstream
// doesn't hammer the provider. Cleanly stoppable for graceful shutdown.
import type { Entity } from 'shared/entity';

export interface PollerLogger {
  warn: (msg: string, err?: unknown) => void;
}

export interface PollerOptions {
  /** Base poll interval in ms (used when there have been no recent failures). */
  intervalMs: number;
  /** Fetch one round of entities; return [] / undefined for "nothing new". */
  fetchFn: () => Promise<Entity | Entity[] | undefined>;
  /** Called for each resolved entity. */
  onEntities: (entities: Entity[]) => void;
  /** Max backoff multiplier applied to intervalMs after consecutive failures. */
  maxBackoffMultiplier?: number;
  logger?: PollerLogger;
  /** Label used in log messages (defaults to 'poller'). */
  label?: string;
}

export interface Poller {
  stop: () => void;
}

const DEFAULT_MAX_BACKOFF_MULTIPLIER = 8;
/** Jitter as a fraction of the current interval, applied +/- to avoid thundering-herd polls. */
const JITTER_FRACTION = 0.2;

/**
 * Start a poller. Runs `fetchFn` immediately, then again every `intervalMs`
 * (with jitter), doubling the effective interval on each consecutive
 * failure up to `maxBackoffMultiplier`, resetting to the base interval on
 * the next success. Errors are logged and never stop the loop.
 */
export function startPoller(options: PollerOptions): Poller {
  const {
    intervalMs,
    fetchFn,
    onEntities,
    maxBackoffMultiplier = DEFAULT_MAX_BACKOFF_MULTIPLIER,
    logger = console,
    label = 'poller',
  } = options;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let consecutiveFailures = 0;

  function jittered(ms: number): number {
    const delta = ms * JITTER_FRACTION;
    return Math.round(ms + (Math.random() * 2 - 1) * delta);
  }

  function nextDelay(): number {
    const multiplier = Math.min(2 ** consecutiveFailures, maxBackoffMultiplier);
    return jittered(intervalMs * multiplier);
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(runOnce, nextDelay());
    timer.unref?.();
  }

  async function runOnce(): Promise<void> {
    if (stopped) return;
    try {
      const result = await fetchFn();
      const entities = result === undefined ? [] : Array.isArray(result) ? result : [result];
      if (entities.length > 0) {
        onEntities(entities);
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      logger.warn(`[${label}] poll failed (attempt ${consecutiveFailures})`, err);
    } finally {
      scheduleNext();
    }
  }

  void runOnce();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
