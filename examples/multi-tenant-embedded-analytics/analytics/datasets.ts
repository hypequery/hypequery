import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * `tenantKey` makes the dataset fail closed: every query must carry trusted
 * tenant context, hypequery injects `WHERE tenant_id = ?` itself, and a
 * caller who tries to filter on the tenant field gets a 400. The browser
 * never sees, sends or chooses a tenant id.
 */
export const Events = dataset('events', {
  source: 'events',
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    path: dimension.string({ label: 'Path' }),
    device: dimension.string({ label: 'Device' }),
    statusCode: dimension.number({ column: 'status_code' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    uniqueUsers: measure.countDistinct('userId', { label: 'Active users' }),
    errors: measure.count('eventId', { filters: [gte('statusCode', 500)], label: 'Errors (5xx)' }),
    errorRate: measure.derived({
      label: 'Error rate',
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
    p95LatencyMs: measure.percentile('latencyMs', 0.95, { label: 'p95 latency (ms)' }),
  },
});
