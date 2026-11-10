import { dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

/**
 * The events dataset, pointed at a table that has two projections. Nothing
 * here mentions them: ClickHouse picks a projection per query, so the dataset
 * (and every query against it) is the one you would write without them.
 *
 * The one deliberate choice is `day`: a dimension whose SQL is exactly the
 * aggregate projection's key, `toDate(occurred_at)`. Grouping and filtering on
 * it lets ClickHouse answer from the projection.
 */
export const Events = dataset('events', {
  source: 'projection_for_dataset_queries_events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    day: dimension.timestamp({ sql: 'toDate(occurred_at)', dependencies: ['occurred_at'], label: 'Day' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    userId: dimension.number({ column: 'user_id' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    totalLatencyMs: measure.sum('latencyMs', { label: 'Total latency (ms)' }),
    avgLatencyMs: measure.derived({
      label: 'Average latency (ms)',
      uses: { total: 'totalLatencyMs', n: 'events' },
      formula: ({ total, n }) => divide(total, nullIfZero(n)),
    }),
  },
});
