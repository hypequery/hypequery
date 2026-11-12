import { dataset, dimension, eq, measure, neq } from '@hypequery/datasets';

/**
 * Billable usage, defined once. The invoice preview, the in-app usage widget
 * and the billing job all read these measures, so the number on the invoice
 * and the number on the dashboard cannot drift. `tenantKey` makes every query
 * fail closed: no trusted tenant context, no SQL.
 */
export const Usage = dataset('usage', {
  source: 'events',
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    tenantId: dimension.number({ column: 'tenant_id' }),
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
  },
  measures: {
    apiCalls: measure.count('eventId', { filters: [eq('eventType', 'api_call')], label: 'API calls' }),
    queryRuns: measure.count('eventId', { filters: [eq('eventType', 'query_run')], label: 'Query runs' }),
  },
});

/**
 * One row per subscription period (upgrades close a row and open a new one),
 * so "the plan on date D" and "MRR on date D" are point-in-time filters:
 * startedAt <= D < endsAt. Open periods end in 2100.
 */
export const Subscriptions = dataset('subscriptions', {
  source: 'subscriptions',
  tenantKey: 'tenant_id',
  timeKey: 'started_at',
  dimensions: {
    tenantId: dimension.number({ column: 'tenant_id' }),
    plan: dimension.string(),
    status: dimension.string(),
    billingInterval: dimension.string({ column: 'billing_interval' }),
    amount: dimension.string({ sql: 'toString(amount)' }),
    currency: dimension.string(),
    startedAt: dimension.timestamp({ column: 'started_at' }),
    endsAt: dimension.timestamp({ sql: "ifNull(ended_at, toDate('2100-01-01'))" }),
  },
  measures: {
    // Annual rows are charged once a year; MRR spreads them over 12 months.
    // Decimal(18, 4) keeps 1990 / 12 exact to the hundredth of a cent.
    mrr: measure.sum('amount', {
      sql: "if(billing_interval = 'annual', toDecimal64(amount, 4) / 12, toDecimal64(amount, 4))",
      filters: [neq('status', 'trialing')],
      label: 'MRR',
    }),
    subscriptions: measure.count('tenantId', { filters: [neq('status', 'trialing')], label: 'Paying subscriptions' }),
  },
});
