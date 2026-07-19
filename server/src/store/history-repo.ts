// In-memory history store: latest-per-entity snapshot + append-only track
// history, held in plain Maps. This deliberately has NO durable backend —
// state is lost on restart. That trade-off keeps the deploy light: no native
// addon (better-sqlite3) to compile, no data volume, no backup/restore.
//
// It keeps the exact public API the SQLite-backed version had, so the
// EntityStore, the /history route, and the tests are unchanged. Trail depth
// is bounded by the retention prune (HISTORY_RETENTION), same as before —
// only now that bound protects RAM instead of disk.
import type { Entity } from 'shared/entity';

// A trail point is just the path over time — lat/lon/altitude/ts. Motion
// (heading/speed/climb) is metadata on the live entity, not part of the trail.
export interface TrackPoint {
  lat: number;
  lon: number;
  altitude_m: number;
  ts: number;
}

/** A stored point: the public TrackPoint fields plus the server-receive time. */
interface StoredPoint extends TrackPoint {
  /** server wall-clock at insert time — the ordering key history() uses (M2). */
  recvTs: number;
}

export class HistoryRepo {
  /** Latest-per-entity snapshot, keyed by id. */
  private readonly entities = new Map<string, Entity>();
  /** Append-only track points per entity id, in arrival order. */
  private readonly points = new Map<string, StoredPoint[]>();

  // The `path` arg is accepted for signature compatibility with the previous
  // SQLite-backed store (callers/tests pass a path or ':memory:'); this
  // in-memory store ignores it — everything is ':memory:' now.
  constructor(_path?: string) {}

  /** Upsert the latest-per-entity snapshot. */
  upsertEntity(e: Entity): void {
    // Deep clone so a later external mutation of the caller's object can't
    // retroactively change the stored snapshot (matches the copy semantics
    // the SQLite row round-trip gave for free).
    this.entities.set(e.id, structuredClone(e));
  }

  /**
   * Append an immutable track point for this entity's history. `recvTs`
   * defaults to now (server receive time) and is the value history() orders
   * by (M2) — override only in tests that need a specific receive time.
   */
  appendPoint(e: Entity, recvTs: number = Date.now()): void {
    const arr = this.points.get(e.id);
    const point: StoredPoint = {
      lat: e.lat,
      lon: e.lon,
      altitude_m: e.altitude_m,
      ts: e.ts,
      recvTs,
    };
    if (arr) {
      arr.push(point);
    } else {
      this.points.set(e.id, [point]);
    }
  }

  /** Recent track points for an entity, oldest-first (by recv time), for trails/replay. */
  history(id: string, sinceTs?: number, limit = 1000): TrackPoint[] {
    const arr = this.points.get(id);
    if (!arr) return [];

    // Order by arrival (recvTs) ascending, not the source-supplied `ts` — a
    // misbehaving/hostile signed source could scramble `ts` and zig-zag the
    // trail (M2). Array.sort is stable, so equal recvTs keeps insertion order.
    const ordered = [...arr].sort((a, b) => a.recvTs - b.recvTs);

    const result: TrackPoint[] = [];
    for (const p of ordered) {
      if (sinceTs !== undefined && p.ts < sinceTs) continue;
      result.push({
        lat: p.lat,
        lon: p.lon,
        altitude_m: p.altitude_m,
        ts: p.ts,
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  /** Drop an entity's latest snapshot so it won't warm the live store on the
   * next boot (its trail history in `points` is left intact for replay). */
  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  /** Latest-per-entity snapshot — used to warm the live store on boot (empty after a restart). */
  loadEntities(): Entity[] {
    return [...this.entities.values()].map((e) => structuredClone(e));
  }

  /** Drop track points whose source `ts` is older than `olderThanMs` ago (retention). Returns points removed. */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, arr] of this.points) {
      const kept = arr.filter((p) => p.ts >= cutoff);
      removed += arr.length - kept.length;
      if (kept.length === 0) {
        this.points.delete(id);
      } else if (kept.length !== arr.length) {
        this.points.set(id, kept);
      }
    }
    return removed;
  }

  /** No-op — kept so callers that closed a DB connection still type-check. */
  close(): void {}
}
