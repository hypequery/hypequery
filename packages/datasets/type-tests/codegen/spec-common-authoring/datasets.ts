// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, measure } from '../../../src/index.js';

export const OrdersDataset = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: { amount: dimension.number(), createdAt: dimension.timestamp(), status: dimension.string() },
  measures: {
    paidRevenue: measure.sum('amount', { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] }),
    revenue: measure.sum('amount'),
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  orders: OrdersDataset,
};
