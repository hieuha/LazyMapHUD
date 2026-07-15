// GET /history/:id?since=&limit= — recent track points for trails/replay,
// served straight from the durable HistoryRepo (independent of live TTL —
// history survives after an entity drops out of the live view).
import type { FastifyInstance } from 'fastify';
import type { HistoryRepo } from '../store/history-repo.js';

export interface HistoryRouteOptions {
  repo: HistoryRepo;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

export function registerHistoryRoute(app: FastifyInstance, options: HistoryRouteOptions): void {
  const { repo } = options;

  app.get<{
    Params: { id: string };
    Querystring: { since?: string; limit?: string };
  }>('/history/:id', async (req, reply) => {
    const { id } = req.params;
    if (!id) {
      return reply.code(400).send({ error: 'bad_request', message: 'missing id' });
    }

    const { since, limit } = req.query;

    let sinceTs: number | undefined;
    if (since !== undefined) {
      sinceTs = Number(since);
      if (!Number.isFinite(sinceTs)) {
        return reply.code(400).send({ error: 'bad_request', message: 'invalid since' });
      }
    }

    let limitN = DEFAULT_LIMIT;
    if (limit !== undefined) {
      limitN = Number(limit);
      if (!Number.isFinite(limitN) || limitN <= 0) {
        return reply.code(400).send({ error: 'bad_request', message: 'invalid limit' });
      }
      limitN = Math.min(limitN, MAX_LIMIT);
    }

    const points = repo.history(id, sinceTs, limitN);
    return reply.code(200).send({ id, points });
  });
}
