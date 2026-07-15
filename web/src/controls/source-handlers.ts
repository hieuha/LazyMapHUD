// Builds the EntitySourceHandlers the live WebSocketSource feeds into.
// Roster rows only rebuild when *membership* changes (id added/removed) —
// N-entity perf: high-Hz position updates go through Roster.refresh()'s cheap
// per-row querySelector path instead of a full innerHTML rebuild every tick.
// Guards the tracked-entity/selection state (Request 2): if the currently
// selected/tracked id is no longer present in the roster — a snapshot arrives
// without it, or an explicit TTL `remove` — selection + the tracking
// indicator + detail panel + map crosshair (all keyed off `store.selectedId`)
// clear back to the empty placeholder state instead of showing stale data.
import type { EntityEngine } from '../entities/entity-engine.js';
import type { EntitySourceHandlers } from '../entities/entity-source.js';
import type { Roster } from '../panels/roster.js';
import type { DetailReadout } from '../panels/detail-readout.js';
import { store } from '../state/store.js';

export interface SourceHandlersController {
  handlers: EntitySourceHandlers;
}

export function createSourceHandlers(
  engine: EntityEngine,
  roster: Roster,
  detail: DetailReadout,
  selectAndTrack: (id: string) => void,
): SourceHandlersController {
  let autoSelected = false;
  let knownCount = -1;

  const rebuildRosterIfMembershipChanged = (): void => {
    if (engine.entities.length === knownCount) return;
    knownCount = engine.entities.length;
    roster.build();
  };
  const maybeAutoSelect = (): void => {
    if (autoSelected || engine.entities.length === 0) return;
    autoSelected = true;
    selectAndTrack(engine.entities[0]!.id);
  };
  /** Clear selection/tracking if the currently selected id fell out of the roster. */
  const clearSelectionIfMissing = (): void => {
    if (!store.selectedId) return;
    if (engine.entities.some((e) => e.id === store.selectedId)) return;
    autoSelected = false;
    store.selectedId = '';
    detail.clear();
  };

  const handlers: EntitySourceHandlers = {
    onSnapshot: (): void => {
      rebuildRosterIfMembershipChanged();
      clearSelectionIfMissing();
      maybeAutoSelect();
      if (autoSelected) detail.select(store.selectedId);
    },
    onUpsert: (): void => {
      rebuildRosterIfMembershipChanged();
      maybeAutoSelect();
    },
    onRemove: (): void => {
      rebuildRosterIfMembershipChanged();
      clearSelectionIfMissing();
    },
  };

  return { handlers };
}
