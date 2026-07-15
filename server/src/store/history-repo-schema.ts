// SQLite schema DDL + migrations for HistoryRepo — split out of
// history-repo.ts to keep that file focused on the read/write API (matches
// the existing history-repo-rows.ts split for row shapes/meta helpers).
import type Database from 'better-sqlite3';

/**
 * Create the base tables/indexes (idempotent) and run additive migrations
 * against an already-open database. Safe to call on both a fresh `:memory:`
 * db and a pre-existing on-disk file from an older version of this schema.
 */
export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude_m REAL NOT NULL,
      heading REAL NOT NULL,
      speed_ms REAL NOT NULL,
      climb_ms REAL NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_points (
      id TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude_m REAL NOT NULL,
      heading REAL NOT NULL,
      speed_ms REAL NOT NULL,
      climb_ms REAL NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_track_points_id_ts
      ON track_points (id, ts);
  `);

  // D5: meta JSON column added after initial launch — guard for existing DB
  // files that predate it (ALTER TABLE ADD COLUMN is a no-op error if the
  // column already exists, so check pragma first).
  const entityColumns = db.pragma('table_info(entities)') as Array<{ name: string }>;
  if (!entityColumns.some((c) => c.name === 'meta')) {
    db.exec(`ALTER TABLE entities ADD COLUMN meta TEXT`);
  }

  // M2 (Phase 7 hardening review): server-receive-time column, independent
  // of the source-supplied `ts`. A misbehaving or hostile signed source
  // could send out-of-order/garbled `ts` values that would otherwise
  // scramble trail ordering; `recv_ts` (wall-clock at insert time) is the
  // ordering key history() actually uses. Safe ALTER for pre-existing DB
  // files; backfilled from `ts` so old rows keep a sane order.
  const trackPointColumns = db.pragma('table_info(track_points)') as Array<{ name: string }>;
  if (!trackPointColumns.some((c) => c.name === 'recv_ts')) {
    db.exec(`ALTER TABLE track_points ADD COLUMN recv_ts INTEGER`);
    db.exec(`UPDATE track_points SET recv_ts = ts WHERE recv_ts IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_track_points_id_recv_ts ON track_points (id, recv_ts)`);
  }
}
