import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Entity } from 'shared/entity';
import { HistoryRepo } from '../src/store/history-repo.js';
import { EntityStore } from '../src/store/entity-store.js';

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

describe('EntityStore', () => {
  let repo: HistoryRepo;
  let store: EntityStore;

  beforeEach(() => {
    repo = new HistoryRepo(':memory:');
    store = new EntityStore(repo);
  });

  afterEach(() => {
    store.stopSweep();
    repo.close();
    vi.useRealTimers();
  });

  it('upsert persists to repo and coalesces the live view to one entry', () => {
    store.upsert(makeEntity({ ts: 1000, lat: 1 }));
    store.upsert(makeEntity({ ts: 2000, lat: 2 }));

    expect(store.snapshot()).toHaveLength(1);
    expect(store.get('balloon-1')?.lat).toBe(2);

    const persisted = repo.loadEntities();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.lat).toBe(2);
  });

  it('upsert emits an upsert event', () => {
    const spy = vi.fn();
    store.on('upsert', spy);
    const e = makeEntity();
    store.upsert(e);
    expect(spy).toHaveBeenCalledWith(e);
  });

  it('throttles history appends to >=1/sec/id while still updating the live snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    store.upsert(makeEntity({ ts: 1_000_000, lat: 1 }));
    vi.setSystemTime(1_000_200);
    store.upsert(makeEntity({ ts: 1_000_200, lat: 2 }));
    vi.setSystemTime(1_000_400);
    store.upsert(makeEntity({ ts: 1_000_400, lat: 3 }));

    // Only the first append within the 1s window should have landed in history.
    expect(repo.history('balloon-1')).toHaveLength(1);
    // But the live view + latest snapshot reflect the most recent upsert.
    expect(store.get('balloon-1')?.lat).toBe(3);
    expect(repo.loadEntities()[0]?.lat).toBe(3);

    vi.setSystemTime(1_001_100);
    store.upsert(makeEntity({ ts: 1_001_100, lat: 4 }));
    expect(repo.history('balloon-1')).toHaveLength(2);
  });

  it('TTL sweep removes stale entities from the live view and emits remove, but retains history', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    store = new EntityStore(repo, { defaultTtlMs: 1000 });

    const removeSpy = vi.fn();
    store.on('remove', removeSpy);

    store.upsert(makeEntity({ ts: 0 }));
    store.startSweep(100);

    vi.advanceTimersByTime(1500);

    expect(store.get('balloon-1')).toBeUndefined();
    expect(store.snapshot()).toHaveLength(0);
    expect(removeSpy).toHaveBeenCalledWith('balloon-1');

    // History persists in SQLite even after live removal.
    expect(repo.history('balloon-1')).toHaveLength(1);
    expect(repo.loadEntities()).toHaveLength(1);
  });

  it('warmFromHistory restores latest-per-entity snapshots into the live view', () => {
    repo.upsertEntity(makeEntity({ id: 'a', ts: 1000 }));
    repo.upsertEntity(makeEntity({ id: 'b', ts: 2000 }));

    store.warmFromHistory();

    const ids = store.snapshot().map((e) => e.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('enforces a max-N live cap by evicting the oldest-seen entities', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    store = new EntityStore(repo, { maxLive: 2 });

    const removeSpy = vi.fn();
    store.on('remove', removeSpy);

    store.upsert(makeEntity({ id: 'a', ts: 0 }));
    vi.setSystemTime(10);
    store.upsert(makeEntity({ id: 'b', ts: 10 }));
    vi.setSystemTime(20);
    store.upsert(makeEntity({ id: 'c', ts: 20 }));

    expect(store.snapshot()).toHaveLength(2);
    expect(store.get('a')).toBeUndefined();
    expect(removeSpy).toHaveBeenCalledWith('a');
    expect(store.get('b')).toBeDefined();
    expect(store.get('c')).toBeDefined();
  });
});
