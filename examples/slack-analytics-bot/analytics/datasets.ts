import { dataset, dimension, divide, eq, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * What your team can ask about in Slack. This bot is for your own team, so
 * the datasets span every customer (no `tenantKey`): `tenantId` is a
 * dimension to group or filter by, not a boundary. Who sees which dataset is
 * decided per person and per channel in lib/team.ts.
 */
export const Events = dataset('events', {
  source: 'events',
  description: 'Product events across all customers: page views, API calls, query runs, logins, exports and errors, with latency and status code.',
  timeKey: 'occurred_at',
  limits: { maxResultSize: 200 },
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at', label: 'Occurred at' }),
    tenantId: dimension.number({ column: 'tenant_id', label: 'Customer id' }),
    userId: dimension.number({ column: 'user_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type', description: 'page_view, api_call, query_run, login, export or error' }),
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

/** Revenue: only admins get this dataset (lib/team.ts). */
export const Subscriptions = dataset('subscriptions', {
  source: 'subscriptions',
  description: 'Subscriptions across all customers per plan and billing interval, with status and billed amount in each currency.',
  timeKey: 'started_at',
  timeGrains: ['month', 'quarter', 'year'],
  dimensions: {
    subscriptionId: dimension.number({ column: 'subscription_id' }),
    tenantId: dimension.number({ column: 'tenant_id', label: 'Customer id' }),
    plan: dimension.string({ label: 'Plan', description: 'starter, growth or enterprise' }),
    status: dimension.string({ label: 'Status', description: 'active, trialing, past_due or canceled' }),
    billingInterval: dimension.string({ column: 'billing_interval', label: 'Billing interval', description: 'monthly or annual' }),
    currency: dimension.string({ label: 'Currency', description: 'Billing currency: USD or EUR' }),
    startedAt: dimension.timestamp({ column: 'started_at', label: 'Started at' }),
  },
  measures: {
    subscriptions: measure.count('subscriptionId', { label: 'Subscription periods' }),
    activeSubscriptions: measure.count('subscriptionId', { filters: [eq('status', 'active')], label: 'Active subscriptions' }),
    // Customers are billed in USD or EUR, and a sum across currencies means
    // nothing, so each currency has its own measure and there is no mixed
    // total to ask for. Add a measure when you start billing in another one.
    billedAmountUsd: measure.sum('amount', {
      filters: [eq('currency', 'USD')],
      label: 'Billed amount (USD)',
      description: 'Sum of amount charged per billing interval, USD subscriptions only; annual rows bill once a year',
      currency: 'USD',
    }),
    billedAmountEur: measure.sum('amount', {
      filters: [eq('currency', 'EUR')],
      label: 'Billed amount (EUR)',
      description: 'Sum of amount charged per billing interval, EUR subscriptions only; annual rows bill once a year',
      currency: 'EUR',
    }),
  },
});
