import { dataset, dimension, divide, eq, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * What the agent is allowed to ask about. Labels and descriptions matter
 * here: they are the only documentation the agent sees through
 * `get_dataset_schema`. Both datasets carry `tenantKey`, so the server must
 * be started with a trusted tenant and every query is scoped to it.
 */
export const Events = dataset('events', {
  source: 'events',
  description: 'Product events: page views, API calls, query runs, logins, exports and errors, with latency and status code.',
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  limits: { maxResultSize: 200 },
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at', label: 'Occurred at' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
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

export const Subscriptions = dataset('subscriptions', {
  source: 'subscriptions',
  description: 'Subscriptions per plan and billing interval, with status and billed amount.',
  tenantKey: 'tenant_id',
  timeKey: 'started_at',
  timeGrains: ['month', 'quarter', 'year'],
  dimensions: {
    subscriptionId: dimension.number({ column: 'subscription_id' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    plan: dimension.string({ label: 'Plan', description: 'starter, growth or enterprise' }),
    status: dimension.string({ label: 'Status', description: 'active, trialing, past_due or canceled' }),
    billingInterval: dimension.string({ column: 'billing_interval', label: 'Billing interval', description: 'monthly or annual' }),
    startedAt: dimension.timestamp({ column: 'started_at', label: 'Started at' }),
  },
  measures: {
    subscriptions: measure.count('subscriptionId', { label: 'Subscription periods' }),
    activeSubscriptions: measure.count('subscriptionId', { filters: [eq('status', 'active')], label: 'Active subscriptions' }),
    billedAmount: measure.sum('amount', { label: 'Amount per billing interval', description: 'Sum of amount charged per interval; annual rows bill once a year' }),
  },
});
