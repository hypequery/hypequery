import { dataset, dimension, measure } from '@hypequery/datasets';

/**
 * Events per path. The dataset owns the definition of the measure, and
 * covers the single-group case: top paths for one tenant is a plain
 * ORDER BY ... LIMIT, which a dataset query renders from `limit`.
 *
 * Top N for every tenant in one query needs ClickHouse's LIMIT BY, which the
 * query builder exposes as `.limitBy()` (see src/recipe.ts). Datasets do not
 * have LIMIT BY or window ranking today.
 */
export const TenantPaths = dataset('tenantPaths', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    path: dimension.string({ label: 'Path' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
  },
});
