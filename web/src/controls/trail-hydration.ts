// Trail hydration: when a live entity is selected/tracked, fetch its real
// flown path from GET /history/:id (server-side in-memory history) and
// prepend it to the entity's in-memory trail so the rendered line reflects
// history the browser never directly observed, not just points seen since
// this tab connected.
import type { EntityEngine } from '../entities/entity-engine.js';
import { fetchHistory } from '../net/history-client.js';

const HISTORY_LIMIT = 500;

export function wireTrailHydration(engine: EntityEngine): (id: string) => void {
  return (id: string): void => {
    void fetchHistory(id, { limit: HISTORY_LIMIT }).then((points) => {
      if (points.length === 0) return;
      engine.hydrateTrail(
        id,
        points.map((p) => [p.lat, p.lon] as [number, number]),
      );
    });
  };
}
