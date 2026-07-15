// Live entity state: an in-memory Map layered over the durable HistoryRepo.
// The Map is the source of truth for "what's on the HUD right now"; the
// repo is the source of truth for durability + trail history. Emits
// 'upsert'/'remove' for the WebSocket hub (Phase 3) to broadcast.
import { EventEmitter } from 'node:events';
import type { Entity, EntityType } from 'shared/entity';
import type { HistoryRepo } from './history-repo.js';

/** Per-type live TTL (ms) before an entity is dropped from the live view. */
export type TtlByType = Partial<Record<EntityType, number>>;

const DEFAULT_TTL_MS = 120_000;
/** Minimum interval between durable history appends for the same id. */
const HISTORY_APPEND_THROTTLE_MS = 1_000;
/** Live Map cap — oldest-by-lastSeen entities are evicted beyond this. */
const DEFAULT_MAX_LIVE = 500;
const SWEEP_INTERVAL_MS = 5_000;

interface LiveRecord {
  entity: Entity;
  /** server receive time — used for TTL, independent of source `ts` (clock skew). */
  lastSeenAt: number;
  expiresAt: number;
  lastHistoryAppendAt: number;
}

export interface EntityStoreOptions {
  ttlByType?: TtlByType;
  defaultTtlMs?: number;
  maxLive?: number;
}

type EntityStoreEvents = {
  upsert: [entity: Entity];
  remove: [id: string];
};

export class EntityStore extends EventEmitter<EntityStoreEvents> {
  private readonly live = new Map<string, LiveRecord>();
  private readonly ttlByType: TtlByType;
  private readonly defaultTtlMs: number;
  private readonly maxLive: number;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repo: HistoryRepo,
    options: EntityStoreOptions = {},
  ) {
    super();
    this.ttlByType = options.ttlByType ?? {};
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxLive = options.maxLive ?? DEFAULT_MAX_LIVE;
  }

  private ttlFor(type: EntityType): number {
    return this.ttlByType[type] ?? this.defaultTtlMs;
  }

  /**
   * Accept a validated entity: update live view, persist snapshot, and
   * (throttled) append a durable history point. Emits 'upsert'.
   */
  upsert(e: Entity): void {
    const now = Date.now();
    const existing = this.live.get(e.id);

    this.live.set(e.id, {
      entity: e,
      lastSeenAt: now,
      expiresAt: now + this.ttlFor(e.type),
      lastHistoryAppendAt: existing?.lastHistoryAppendAt ?? -Infinity,
    });

    this.repo.upsertEntity(e);

    const record = this.live.get(e.id)!;
    if (now - record.lastHistoryAppendAt >= HISTORY_APPEND_THROTTLE_MS) {
      this.repo.appendPoint(e);
      record.lastHistoryAppendAt = now;
    }

    this.enforceMaxLive();
    this.emit('upsert', e);
  }

  /** Evict oldest-by-lastSeen live entities beyond the cap (does not touch history). */
  private enforceMaxLive(): void {
    if (this.live.size <= this.maxLive) return;
    const overflow = this.live.size - this.maxLive;
    const oldest = [...this.live.entries()]
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
      .slice(0, overflow);
    for (const [id] of oldest) {
      this.live.delete(id);
      this.emit('remove', id);
    }
  }

  get(id: string): Entity | undefined {
    return this.live.get(id)?.entity;
  }

  /** Snapshot of all currently-live entities. */
  snapshot(): Entity[] {
    return [...this.live.values()].map((r) => r.entity);
  }

  /** Restore latest-per-entity snapshot from SQLite into the live Map on boot. */
  warmFromHistory(): void {
    const now = Date.now();
    for (const e of this.repo.loadEntities()) {
      this.live.set(e.id, {
        entity: e,
        lastSeenAt: now,
        expiresAt: now + this.ttlFor(e.type),
        lastHistoryAppendAt: -Infinity,
      });
    }
  }

  /** Start the periodic TTL sweep that drops stale entities from the live view. */
  startSweep(intervalMs = SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
    this.sweepTimer.unref?.();
  }

  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.live) {
      if (record.expiresAt <= now) {
        this.live.delete(id);
        this.emit('remove', id);
      }
    }
  }
}
