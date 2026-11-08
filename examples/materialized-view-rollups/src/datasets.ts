import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

const DAY_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/** The raw fact table: a million rows, aggregated at query time. */
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type' }),
    statusCode: dimension.number({ column: 'status_code' }),
  },
  measures: {
    events: measure.count('eventId'),
    uniqueUsers: measure.countDistinct('userId'),
    errors: measure.count('statusCode', { filters: [gte('statusCode', 500)] }),
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});

/**
 * Incremental rollup (sql/01-incremental.sql). Reads aggregate states, so
 * `measure.merge` applies `uniqExactMerge` and uniques stay exact at any grain.
 */
export const EventsDaily = dataset('eventsDaily', {
  source: 'events_daily',
  timeKey: 'day',
  timeGrains: [...DAY_GRAINS],
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    eventType: dimension.string({ column: 'event_type' }),
  },
  measures: {
    events: measure.sum('events'),
    errors: measure.sum('errors'),
    uniqueUsers: measure.merge('uniqExact', 'users'),
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});

/**
 * Refreshable rollup (sql/02-refreshable.sql). Final values per tenant-day,
 * including a JOIN to `tenants` and an exact p95, recomputed every hour.
 */
export const TenantDailySummary = dataset('tenantDailySummary', {
  source: 'tenant_daily_summary',
  timeKey: 'day',
  timeGrains: [...DAY_GRAINS],
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    tenantName: dimension.string({ column: 'tenant_name' }),
    plan: dimension.string(),
  },
  measures: {
    events: measure.sum('events'),
    errors: measure.sum('errors'),
    worstP95LatencyMs: measure.max('p95_latency_ms', { label: 'Worst daily p95 latency (ms)' }),
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});
