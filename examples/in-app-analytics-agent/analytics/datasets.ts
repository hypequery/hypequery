import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * The one dataset the agent can query, deployed to hypequery Cloud with
 * `hypequery deploy analytics/cloud.ts`. It reads the shared seed's `events`
 * table (examples/_seed).
 *
 * `tenantKey: 'tenant_id'` makes it fail closed: Cloud adds
 * `WHERE tenant_id = <the token's tenant>` to every query, refuses a query
 * without a tenant, and refuses a filter on the tenant field. Labels and
 * descriptions are what the agent reads through `get_dataset_schema`.
 */
export const Events = dataset('events', {
  source: 'events',
  description: 'Product events for the signed-in customer: page views, API calls, query runs, logins, exports and errors, with latency and status code.',
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  limits: { maxResultSize: 200 },
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at', label: 'Occurred at' }),
    tenantId: dimension.number({ column: 'tenant_id', label: 'Customer id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type', description: 'page_view, api_call, query_run, login, export or error' }),
    path: dimension.string({ label: 'Path', description: 'Page or API path the event hit' }),
    device: dimension.string({ label: 'Device', description: 'desktop, mobile, tablet or api' }),
    statusCode: dimension.number({ column: 'status_code', label: 'HTTP status code' }),
    latencyMs: dimension.number({ column: 'latency_ms', label: 'Latency (ms)' }),
  },
  measures: {
    events: measure.count('eventId', { label: 'Events', description: 'Number of events' }),
    uniqueUsers: measure.countDistinct('userId', { label: 'Active users', description: 'Distinct users with at least one event' }),
    errors: measure.count('eventId', { filters: [gte('statusCode', 500)], label: 'Errors (5xx)' }),
    errorRate: measure.derived({
      label: 'Error rate',
      description: 'Errors divided by events, 0 to 1',
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
    p95LatencyMs: measure.percentile('latencyMs', 0.95, { label: 'p95 latency (ms)', description: 'Approximate 95th percentile of latency' }),
  },
});
