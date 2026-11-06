// A TypeScript serve API whose frontend lives in another repository. The
// round-trip test exports its client contract and generates React types from it.
import { createAPI, dataset, dimension, divide, measure, nullIfZero } from '@hypequery/serve';

const Orders = dataset('orders', {
  source: 'orders',
  description: 'One row per order.',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string({ label: 'Country' }),
    amount: dimension.number(),
    paid: dimension.boolean(),
    createdAt: dimension.timestamp({ column: 'created_at', groupable: false }),
  },
  measures: {
    revenue: measure.sum('amount', { description: 'Gross revenue' }),
    orders: measure.count('country'),
    latestCountry: measure.max('country'),
    averageOrder: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
  filters: {
    country: { __type: 'filter_definition', field: 'country', operators: ['eq', 'in'] },
    paid: { __type: 'filter_definition', field: 'paid', operators: ['eq'] },
    minimumAmount: { __type: 'filter_definition', field: 'amount', operators: ['gte'] },
  },
});

export const api = createAPI({
  // Execution needs a ClickHouse query builder; exporting the contract never runs one.
  queryBuilder: {
    table: () => { throw new Error('Not connected.'); },
    rawQuery: async () => { throw new Error('Not connected.'); },
  },
  datasets: { orders: Orders },
  metrics: { totalRevenue: Orders.metric('totalRevenue', { measure: 'revenue' }) },
});
