import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Entity } from 'shared/entity';
import { HistoryRepo } from '../src/store/history-repo.js';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'balloon-1',
    name: 'balloon-1',
    type: 'balloon',
    lat: 21.0285,
    lon: 105.8542,
    altitude_m: 1500,
    ts: Date.now(),
    ...overrides,
  };
}

describe('HistoryRepo', () => {
  let repo: HistoryRepo;

  beforeEach(() => {
    repo = new HistoryRepo(':memory:');
  });

  afterEach(() => {
    repo.close();
  });

  it('upsertEntity + loadEntities round-trips the latest snapshot', () => {
    const e = makeEntity();
    repo.upsertEntity(e);
    const loaded = repo.loadEntities();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(e);
  });

  it('upsertEntity replaces the prior snapshot for the same id', () => {
    repo.upsertEntity(makeEntity({ ts: 1000, lat: 10 }));
    repo.upsertEntity(makeEntity({ ts: 2000, lat: 20 }));
    const loaded = repo.loadEntities();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.lat).toBe(20);
    expect(loaded[0]?.ts).toBe(2000);
  });

  it('appendPoint + history returns points oldest-first (by recv_ts, arrival order)', () => {
    repo.appendPoint(makeEntity({ ts: 1000, lat: 1 }), 1000);
    repo.appendPoint(makeEntity({ ts: 3000, lat: 3 }), 2000);
    repo.appendPoint(makeEntity({ ts: 2000, lat: 2 }), 3000);

    const points = repo.history('balloon-1');
    expect(points.map((p) => p.lat)).toEqual([1, 3, 2]);
  });

  it('history respects sinceTs and limit', () => {
    for (let i = 0; i < 5; i++) {
      repo.appendPoint(makeEntity({ ts: 1000 + i * 1000 }));
    }
    const sinceOnly = repo.history('balloon-1', 3000);
    expect(sinceOnly.map((p) => p.ts)).toEqual([3000, 4000, 5000]);

    const limited = repo.history('balloon-1', undefined, 2);
    expect(limited.map((p) => p.ts)).toEqual([1000, 2000]);
  });

  it('history is scoped per id', () => {
    repo.appendPoint(makeEntity({ id: 'a', ts: 1000 }));
    repo.appendPoint(makeEntity({ id: 'b', ts: 2000 }));
    expect(repo.history('a').map((p) => p.ts)).toEqual([1000]);
    expect(repo.history('b').map((p) => p.ts)).toEqual([2000]);
  });

  it('prune deletes track_points older than the cutoff and reports count', () => {
    const now = Date.now();
    repo.appendPoint(makeEntity({ ts: now - 10_000 }));
    repo.appendPoint(makeEntity({ ts: now - 5_000 }));
    repo.appendPoint(makeEntity({ ts: now }));

    const deleted = repo.prune(6_000);
    expect(deleted).toBe(1);
    expect(repo.history('balloon-1')).toHaveLength(2);
  });

  it('loadEntities returns empty array on a fresh db', () => {
    expect(repo.loadEntities()).toEqual([]);
  });

  it('upsertEntity + loadEntities round-trips meta (D5), including across a re-opened db file', () => {
    const e = makeEntity({ meta: { callsign: 'VN123', freq_mhz: 403, active: true } });
    repo.upsertEntity(e);
    expect(repo.loadEntities()[0]?.meta).toEqual({ callsign: 'VN123', freq_mhz: 403, active: true });
  });

  it('loadEntities omits meta when the entity never had any', () => {
    repo.upsertEntity(makeEntity());
    expect(repo.loadEntities()[0]?.meta).toBeUndefined();
  });

  it('history() orders by server-receive-time (recv_ts), not source ts (M2)', () => {
    // Simulate a hostile/misbehaving signed source: points arrive in this
    // recv order (recv_ts strictly increasing), but each carries a source
    // `ts` that is scrambled relative to arrival order. If ordering used
    // `ts` the trail would zig-zag; recv_ts keeps it monotonic by arrival.
    repo.appendPoint(makeEntity({ ts: 9000, lat: 9 }), 1000); // arrives 1st, claims to be latest
    repo.appendPoint(makeEntity({ ts: 1000, lat: 1 }), 2000); // arrives 2nd, claims to be earliest
    repo.appendPoint(makeEntity({ ts: 5000, lat: 5 }), 3000); // arrives 3rd, claims middle

    const points = repo.history('balloon-1');
    // Ordered by arrival (recv_ts): 9000 -> 1000 -> 5000 (by source ts, which is garbled).
    expect(points.map((p) => p.ts)).toEqual([9000, 1000, 5000]);
    expect(points.map((p) => p.lat)).toEqual([9, 1, 5]);
  });
});
