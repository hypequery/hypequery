// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { dataset, dimension, divide, measure, subtract } from '../../../src/index.js';

export const OrdersDataset = dataset('orders', {
  source: 'orders',
  description: 'Every order.',
  owner: 'ops',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  defaults: { dimensions: ['status'], timeGrain: 'day' },
  dimensions: {
    createdAt: dimension.timestamp({ label: 'Order date', description: 'When placed.', column: 'created_at' }),
    status: dimension.string({ label: 'Status', description: 'Where it is.' }),
    tenant_id: dimension.string({ label: 'Tenant', description: 'Customer.' }),
  },
  measures: {
    orderCount: measure.count('id', { label: 'Orders', description: 'Orders.' }),
    p95: measure.percentile('amount', 0.95, { label: 'P95', description: 'P95.' }),
    paid: measure.sum('amount', {
      label: 'Paid',
      description: 'Paid only.',
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
    }),
    refunds: measure.sum('refund', { label: 'Refunds', description: 'Refunded.' }),
    revenue: measure.sum('amount', { label: 'Revenue', description: 'Paid value.', synonyms: ['sales'], currency: 'EUR' }),
    aov: measure.derived({
      uses: { orderCount: 'orderCount', revenue: 'revenue' },
      formula: ({ orderCount, revenue }) => divide(revenue, orderCount),
      label: 'AOV',
      description: 'Average.',
    }),
    net: measure.derived({
      uses: { refunds: 'refunds', revenue: 'revenue' },
      formula: ({ refunds, revenue }) => subtract(revenue, refunds),
      label: 'Net',
      description: 'Net.',
    }),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq', 'in'],
      label: 'Status',
      description: 'By status.',
    },
  },
});

/** The datasets published with an endpoint. */
export const datasets = {
  orders: OrdersDataset,
};
