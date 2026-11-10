import { dataset, dimension, measure } from '@hypequery/datasets';

/**
 * Request events with latency. `measure.percentile` renders ClickHouse's
 * `quantile(level)`, an approximate percentile that is fast and uses bounded
 * memory on any number of rows. Swap in `quantileExact` only when the exact
 * value matters more than the cost.
 */
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    path: dimension.string(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Requests' }),
    p50LatencyMs: measure.median('latencyMs', { label: 'p50 latency (ms)' }),
    p95LatencyMs: measure.percentile('latencyMs', 0.95, { label: 'p95 latency (ms)' }),
    p99LatencyMs: measure.percentile('latencyMs', 0.99, { label: 'p99 latency (ms)' }),
    maxLatencyMs: measure.max('latencyMs', { label: 'Max latency (ms)' }),
  },
});
