import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPoller } from '../src/adapters/poller.js';
import type { Entity } from 'shared/entity';

const sampleEntity: Entity = {
  id: 'sonde-TEST1',
  type: 'balloon',
  lat: 21,
  lon: 105,
  altitude_m: 100,
  heading: 0,
  speed_ms: 1,
  climb_ms: 1,
  ts: Date.now(),
};

describe('startPoller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fetchFn immediately and forwards resolved entities to onEntities', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sampleEntity);
    const onEntities = vi.fn();

    const poller = startPoller({ intervalMs: 10_000, fetchFn, onEntities });
    // runOnce is fire-and-forget; flush microtasks.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onEntities).toHaveBeenCalledWith([sampleEntity]);

    poller.stop();
  });

  it('does not call onEntities when fetchFn resolves undefined/empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const onEntities = vi.fn();

    const poller = startPoller({ intervalMs: 10_000, fetchFn, onEntities });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onEntities).not.toHaveBeenCalled();
    poller.stop();
  });

  it('tolerates a rejected fetchFn: logs a warning and keeps the loop alive', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    const onEntities = vi.fn();
    const warn = vi.fn();

    const poller = startPoller({
      intervalMs: 10_000,
      fetchFn,
      onEntities,
      logger: { warn },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onEntities).not.toHaveBeenCalled();
    poller.stop();
  });

  it('stop() prevents any further scheduled polls', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(sampleEntity);
    const onEntities = vi.fn();

    const poller = startPoller({ intervalMs: 1_000, fetchFn, onEntities });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    poller.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('accepts an array result from fetchFn and forwards all entities', async () => {
    const second: Entity = { ...sampleEntity, id: 'sonde-TEST2' };
    const fetchFn = vi.fn().mockResolvedValue([sampleEntity, second]);
    const onEntities = vi.fn();

    const poller = startPoller({ intervalMs: 10_000, fetchFn, onEntities });
    await new Promise((resolve) => setImmediate(resolve));

    expect(onEntities).toHaveBeenCalledWith([sampleEntity, second]);
    poller.stop();
  });
});
