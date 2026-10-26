/**
 * The datasets the Postgres corpora and live tests share. They mirror the
 * ClickHouse golden corpus (`packages/datasets/src/tests/golden-sql.test.ts`)
 * minus time measures, which Postgres refuses for now.
 */
import {
  belongsTo,
  coalesce,
  dataset,
  dimension,
  divide,
  eq,
  floor,
  inList,
  measure,
  multiply,
  nullIfZero,
  round,
  subtract,
  add,
  ceil,
} from '@hypequery/datasets';

export const Customers = dataset('customers', {
  source: 'analytics.customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number({ column: 'customer_id' }),
    country: dimension.string({ column: 'country_code' }),
    tier: dimension.string(),
  },
  measures: { customers: measure.countDistinct('id') },
});

export const Orders = dataset('orders', {
  source: 'analytics.orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    customerId: dimension.number({ column: 'customer_id' }),
    status: dimension.string(),
    region: dimension.string({ sql: 'upper(region_code)', dependencies: ['region_code'] }),
    isGift: dimension.boolean({ column: 'is_gift' }),
    amount: dimension.number({ column: 'amount_cents', groupable: false }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    buyers: measure.countDistinct('customerId'),
    approxBuyers: measure.approxCountDistinct('customerId'),
    avgAmount: measure.avg('amount'),
    minAmount: measure.min('amount'),
    maxAmount: measure.max('amount'),
    p95: measure.percentile('amount', 0.95),
    topRegion: measure.argMax('region', 'amount'),
    bottomRegion: measure.argMin('region', 'amount'),
    spread: measure.stddev('amount'),
    variance: measure.variance('amount'),
    paidRevenue: measure.sum('amount', { filters: [eq('status', "paid's \\ quote")] }),
    giftOrders: measure.count('status', { filters: [eq('isGift', true)] }),
    regionalOrders: measure.count('status', { filters: [inList('region', ['EU', 'US'])] }),
    p95Paid: measure.percentile('amount', 0.95, { filters: [eq('status', 'paid')] }),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => round(divide(revenue, nullIfZero(orders)), 2),
    }),
    everyFormula: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders', avg: 'avgAmount' },
      formula: ({ revenue, orders, avg }) => coalesce(
        floor(multiply(add(revenue, subtract(avg, orders)), ceil(divide(revenue, nullIfZero(avg))))),
        0,
      ),
    }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
    running: measure.cumulative('revenue'),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn', 'like'] },
    createdAt: { __type: 'filter_definition', field: 'createdAt', operators: ['gt', 'gte', 'lt', 'lte', 'between'] },
  },
  segments: {
    paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }),
  },
});

export const TENANT = { runtime: { tenant: { id: 'acme' } } } as const;
