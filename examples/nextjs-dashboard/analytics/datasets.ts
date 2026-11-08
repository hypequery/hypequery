import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * One semantic definition of product events. Every panel on the dashboard
 * selects from these dimensions and measures; the server validates each
 * request against this contract, so the browser can never ask for a column
 * that is not published here.
 */
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    device: dimension.string({ label: 'Device' }),
    path: dimension.string({ label: 'Path' }),
    statusCode: dimension.number({ column: 'status_code' }),
    latencyMs: dimension.number({ column: 'latency_ms' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events' }),
    uniqueUsers: measure.countDistinct('userId', { label: 'Unique users' }),
    errors: measure.count('eventId', { filters: [gte('statusCode', 500)], label: 'Errors (5xx)' }),
    errorRate: measure.derived({
      label: 'Error rate',
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
    p95LatencyMs: measure.percentile('latencyMs', 0.95, { label: 'p95 latency (ms)' }),
  },
});
