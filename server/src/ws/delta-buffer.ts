// Coalesces rapid EntityStore 'upsert'/'remove' events between broadcast
// flushes: multiple updates for the same id collapse into a single change,
// keeping only the latest state (or the fact that it was removed).
import type { Entity } from 'shared/entity';

type PendingChange = { kind: 'upsert'; entity: Entity } | { kind: 'remove'; id: string };

export class DeltaBuffer {
  private readonly pending = new Map<string, PendingChange>();

  /** Record an upsert; overwrites any pending change for this id. */
  upsert(entity: Entity): void {
    this.pending.set(entity.id, { kind: 'upsert', entity });
  }

  /** Record a removal; overwrites any pending change for this id. */
  remove(id: string): void {
    this.pending.set(id, { kind: 'remove', id });
  }

  get isEmpty(): boolean {
    return this.pending.size === 0;
  }

  /** Drain buffered changes into separate upsert/remove batches, clearing the buffer. */
  drain(): { upserts: Entity[]; removes: string[] } {
    const upserts: Entity[] = [];
    const removes: string[] = [];
    for (const change of this.pending.values()) {
      if (change.kind === 'upsert') {
        upserts.push(change.entity);
      } else {
        removes.push(change.id);
      }
    }
    this.pending.clear();
    return { upserts, removes };
  }
}
