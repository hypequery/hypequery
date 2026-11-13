// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, divide, measure, nullIfZero } from '../../../src/index.js';

export const OrdersDataset = dataset('orders', {
  source: 'orders',
  dimensions: {},
  measures: {
    orders: measure.count('id'),
    revenue: measure.sum('amount'),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  orders: OrdersDataset,
};
