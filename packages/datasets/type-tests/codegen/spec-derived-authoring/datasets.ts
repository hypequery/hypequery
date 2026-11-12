// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { coalesce, dataset, dimension, divide, measure, nullIfZero } from '../../../src/index.js';

export const OrdersDataset = dataset('orders', {
  source: 'test_db.beta_derived',
  tenantKey: 'tenant_id',
  dimensions: { amount: dimension.number(), category: dimension.string(), status: dimension.string() },
  measures: {
    orders: measure.count('amount'),
    paidRevenue: measure.sum('amount', { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] }),
    revenue: measure.sum('amount'),
    average: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    paidRate: measure.derived({
      uses: { paidRevenue: 'paidRevenue', revenue: 'revenue' },
      formula: ({ paidRevenue, revenue }) => coalesce(divide(paidRevenue, nullIfZero(revenue)), 0),
    }),
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  orders: OrdersDataset,
};
