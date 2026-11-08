import { initServe, type InferApiType } from '@hypequery/serve';
import { db } from './client';
import { Events } from './datasets';

const { serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

/**
 * POST /api/analytics/datasets/events/query
 * Validates dimensions, measures, filters, grain and ordering against the
 * dataset, clamps `limit` to `maxLimit`, and runs the query on ClickHouse.
 */
export const api = serve({
  queryBuilder: db,
  datasets: {
    events: { dataset: Events, maxLimit: 500, cache: 10_000 },
  },
});

export type AnalyticsApi = InferApiType<typeof api>;
