// Durable SQLite persistence (D1): latest-per-entity snapshot + append-only
// track history. Synchronous by design — better-sqlite3 is fast enough for
// the request-path write-through and keeps the store logic simple (no async
// queueing needed for this traffic profile).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Entity } from 'shared/entity';
import { type EntityRow, type TrackPointRow, parseMeta, serializeMeta } from './history-repo-rows.js';
import { migrate } from './history-repo-schema.js';

export interface TrackPoint {
  lat: number;
  lon: number;
  altitude_m: number;
  heading: number;
  speed_ms: number;
  climb_ms: number;
  ts: number;
}

/**
 * SQLite-backed history store. Opens/creates the schema on construction.
 * Pass `:memory:` for tests — schema + WAL both work against an in-memory DB
 * (WAL is a no-op for `:memory:` but harmless to request).
 */
export class HistoryRepo {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db);
    this.prepareStatements();
  }

  // Prepared statements — assigned in prepareStatements(), never left
  // undefined after construction (declared here purely for the strict TS
  // "definite assignment" contract).
  private upsertEntityStmt!: Database.Statement;
  private insertPointStmt!: Database.Statement;
  private loadEntitiesStmt!: Database.Statement;
  private historyStmtNoSince!: Database.Statement;
  private historyStmtSince!: Database.Statement;
  private pruneStmt!: Database.Statement;

  private prepareStatements(): void {
    this.upsertEntityStmt = this.db.prepare(`
      INSERT INTO entities (id, type, lat, lon, altitude_m, heading, speed_ms, climb_ms, ts, meta)
      VALUES (@id, @type, @lat, @lon, @altitude_m, @heading, @speed_ms, @climb_ms, @ts, @meta)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        lat = excluded.lat,
        lon = excluded.lon,
        altitude_m = excluded.altitude_m,
        heading = excluded.heading,
        speed_ms = excluded.speed_ms,
        climb_ms = excluded.climb_ms,
        ts = excluded.ts,
        meta = excluded.meta
    `);

    this.insertPointStmt = this.db.prepare(`
      INSERT INTO track_points (id, lat, lon, altitude_m, heading, speed_ms, climb_ms, ts, recv_ts)
      VALUES (@id, @lat, @lon, @altitude_m, @heading, @speed_ms, @climb_ms, @ts, @recv_ts)
    `);

    this.loadEntitiesStmt = this.db.prepare(`SELECT * FROM entities`);

    // Ordered by recv_ts (server wall-clock at insert time), not the
    // source-supplied ts — see the migrate() comment on recv_ts (M2).
    // COALESCE guards any legacy row where a prior migration left recv_ts
    // NULL (shouldn't happen post-backfill, but keeps ordering safe).
    this.historyStmtNoSince = this.db.prepare(`
      SELECT lat, lon, altitude_m, heading, speed_ms, climb_ms, ts
      FROM track_points
      WHERE id = @id
      ORDER BY COALESCE(recv_ts, ts) ASC
      LIMIT @limit
    `);

    this.historyStmtSince = this.db.prepare(`
      SELECT lat, lon, altitude_m, heading, speed_ms, climb_ms, ts
      FROM track_points
      WHERE id = @id AND ts >= @since
      ORDER BY COALESCE(recv_ts, ts) ASC
      LIMIT @limit
    `);

    this.pruneStmt = this.db.prepare(`DELETE FROM track_points WHERE ts < @cutoff`);
  }

  /** Upsert the latest-per-entity snapshot row. */
  upsertEntity(e: Entity): void {
    this.upsertEntityStmt.run({
      id: e.id,
      type: e.type,
      lat: e.lat,
      lon: e.lon,
      altitude_m: e.altitude_m,
      heading: e.heading,
      speed_ms: e.speed_ms,
      climb_ms: e.climb_ms,
      ts: e.ts,
      meta: serializeMeta(e.meta),
    });
  }

  /**
   * Append an immutable track point for this entity's history. `recvTs`
   * defaults to now (server receive time) and is the column history() orders
   * by (M2) — override only in tests that need to simulate a specific
   * receive time.
   */
  appendPoint(e: Entity, recvTs: number = Date.now()): void {
    this.insertPointStmt.run({
      id: e.id,
      lat: e.lat,
      lon: e.lon,
      altitude_m: e.altitude_m,
      heading: e.heading,
      speed_ms: e.speed_ms,
      climb_ms: e.climb_ms,
      ts: e.ts,
      recv_ts: recvTs,
    });
  }

  /** Recent track points for an entity, oldest-first, for trails/replay. */
  history(id: string, sinceTs?: number, limit = 1000): TrackPoint[] {
    const stmt = sinceTs === undefined ? this.historyStmtNoSince : this.historyStmtSince;
    const params =
      sinceTs === undefined ? { id, limit } : { id, since: sinceTs, limit };
    return stmt.all(params) as TrackPointRow[];
  }

  /** Latest-per-entity snapshot rows — used to warm the live store on boot. */
  loadEntities(): Entity[] {
    const rows = this.loadEntitiesStmt.all() as EntityRow[];
    return rows.map((row) => {
      const entity: Entity = {
        id: row.id,
        type: row.type,
        lat: row.lat,
        lon: row.lon,
        altitude_m: row.altitude_m,
        heading: row.heading,
        speed_ms: row.speed_ms,
        climb_ms: row.climb_ms,
        ts: row.ts,
      };
      const meta = parseMeta(row.meta);
      if (meta) entity.meta = meta;
      return entity;
    });
  }

  /** Delete track_points older than `olderThanMs` ago (retention). Returns rows deleted. */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.pruneStmt.run({ cutoff });
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
