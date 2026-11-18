import { dataset, dimension, divide, eq, gte, measure, nullIfZero, subtract } from './index.js';

/**
 * The authoring side of `specs/datasets/contract-3-authoring-v1.json`: one
 * dataset using every contract 3 feature an author can declare in both
 * TypeScript and Python. Python's `tests/test_contract_3_authoring.py` builds
 * the same definition and must emit the same contract.
 */
export const contract3AuthoringDataset = dataset('events', {
  source: 'analytics.events',
  tenantKey: 'tenant_id',
  timeKey: 'occurredAt',
  dimensions: {
    amount: dimension.number(),
    occurredAt: dimension.timestamp(),
    plan: dimension.string(),
    status: dimension.string(),
    userId: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    visitors: measure.approxCountDistinct('userId', { label: 'Visitors' }),
    revenue7d: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    revenueMtd: measure.toDate('revenue', 'month'),
    revenueRunning: measure.cumulative('revenue'),
    visitors7d: measure.trailing('visitors', { amount: 7, unit: 'day' }),
    revenuePriorWeek: measure.shift('revenue', { amount: 1, unit: 'week' }),
    revenueGrowth: measure.derived({
      uses: { revenue: 'revenue', revenuePriorWeek: 'revenuePriorWeek' },
      formula: ({ revenue, revenuePriorWeek }) => divide(subtract(revenue, revenuePriorWeek), nullIfZero(revenuePriorWeek)),
    }),
    revenuePerVisitor: measure.derived({
      uses: { revenue: 'revenue', visitors: 'visitors' },
      formula: ({ revenue, visitors }) => divide(revenue, nullIfZero(visitors)),
    }),
  },
  segments: {
    enterprise: { filters: [eq('plan', 'enterprise')], description: 'Enterprise plan' },
    bigPaid: { filters: [eq('status', 'paid'), gte('amount', 100)] },
  },
});
