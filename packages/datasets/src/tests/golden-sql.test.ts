/**
 * Golden SQL for every datasets emission path, compiled through the real
 * `@hypequery/clickhouse` builder.
 *
 * These files gate dialect refactors: moving ClickHouse spelling behind
 * `DatasetSqlDialect` must leave every golden file byte-identical. A diff
 * here is a behaviour change and needs its own review, not a snapshot update
 * folded into a refactor. Regenerate deliberately with `vitest -u`.
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../clickhouse/src/index.js';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { add, ceil, coalesce, divide, floor, multiply, nullIfZero, round, subtract } from '../formulas.js';
import { measure } from '../measure.js';
import { eq, inList } from '../query-helpers.js';
import { belongsTo } from '../relationships.js';
import type { DatasetQuery, MetricHandle, TimeGrain } from '../types.js';

const Customers = dataset('customers', {
  source: 'analytics.customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number({ column: 'customer_id' }),
    country: dimension.string({ column: 'country_code' }),
    tier: dimension.string(),
  },
  measures: { customers: measure.countDistinct('id') },
});

const Orders = dataset('orders', {
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
    rollingBuyers: measure.trailing('buyers', { amount: 14, unit: 'day' }),
    monthToDate: measure.toDate('revenue', 'month'),
    running: measure.cumulative('revenue'),
    runningOrders: measure.cumulative('orders'),
    priorYear: measure.shift('revenue', { amount: 1, unit: 'year' }),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
    priorHour: measure.shift('revenue', { amount: 1, unit: 'hour' }),
    yearOverYear: measure.derived({
      uses: { current: 'revenue', prior: 'priorYear' },
      formula: ({ current, prior }) => divide(subtract(current, prior), nullIfZero(prior)),
    }),
    priorAov: measure.shift('averageOrderValue', { amount: 1, unit: 'month' }),
    rollingP95: measure.trailing('p95', { amount: 7, unit: 'day' }),
    rollingTop: measure.trailing('topRegion', { amount: 7, unit: 'day' }),
    runningAov: measure.derived({
      uses: { running: 'running', orders: 'orders' },
      formula: ({ running, orders }) => divide(running, nullIfZero(orders)),
    }),
    runningAovRounded: measure.derived({ uses: { value: 'runningAov' }, formula: ({ value }) => round(value, 2) }),
    monthToDateShare: measure.derived({
      uses: { mtd: 'monthToDate', revenue: 'revenue' },
      formula: ({ mtd, revenue }) => divide(revenue, nullIfZero(mtd)),
    }),
    monthToDateShareRounded: measure.derived({ uses: { value: 'monthToDateShare' }, formula: ({ value }) => round(value, 4) }),
    rollingShare: measure.derived({
      uses: { rolling: 'rolling', running: 'running' },
      formula: ({ rolling, running }) => divide(rolling, nullIfZero(running)),
    }),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn', 'like'] },
    createdAt: { __type: 'filter_definition', field: 'createdAt', operators: ['gt', 'gte', 'lt', 'lte', 'between'] },
  },
  segments: {
    paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
});

const revenueInput = Orders.metric('revenue', { measure: 'revenue' });
const ordersInput = Orders.metric('orders', { measure: 'orders' });
const metrics: Record<string, MetricHandle> = {
  total: Orders.metric('totalRevenue', { measure: 'revenue' }) as MetricHandle,
  monthly: (Orders.metric('monthlyRevenue', { measure: 'revenue' }) as unknown as {
    by(grain: TimeGrain): MetricHandle;
  }).by('month'),
  derived: Orders.metric('aov', {
    uses: { revenue: revenueInput, orders: ordersInput },
    formula: ({ revenue, orders }) => round(divide(revenue, nullIfZero(orders)), 2),
  }) as MetricHandle,
  derivedMonthly: (Orders.metric('monthlyAov', {
    uses: { revenue: revenueInput, orders: ordersInput },
    formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
  }) as unknown as { by(grain: TimeGrain): MetricHandle }).by('week'),
};

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });
const TENANT = { runtime: { tenant: { id: 'acme' } } } as const;
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];
const HOUR_RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-03-07 00:00:00', '2026-03-09 00:00:00'] }];
const GRAINS: TimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];

const datasetCases: Record<string, DatasetQuery> = {
  'aggregate-every-measure': {
    dimensions: ['status'],
    measures: ['revenue', 'orders', 'buyers', 'approxBuyers', 'avgAmount', 'minAmount', 'maxAmount', 'p95', 'topRegion', 'bottomRegion', 'spread', 'variance'],
  },
  'aggregate-filtered-measures': { dimensions: ['region'], measures: ['paidRevenue', 'giftOrders', 'regionalOrders', 'p95Paid'] },
  'aggregate-filters-order-pagination': {
    dimensions: ['status', 'region'],
    measures: ['revenue'],
    filters: [
      { field: 'status', operator: 'in', value: ['paid', 'shipped'] },
      { field: 'status', operator: 'like', value: '%a%' },
      { field: 'createdAt', operator: 'gte', value: '2026-01-01' },
    ],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
    limit: 25,
    offset: 50,
  },
  'aggregate-segment': { dimensions: ['region'], measures: ['revenue'], segments: ['paid'] },
  'relationship-dimension-and-measure': { dimensions: ['customer.country'], measures: ['revenue', 'customer.customers'] },
  'derived-measures': { dimensions: ['status'], measures: ['averageOrderValue', 'everyFormula'], orderBy: [{ field: 'averageOrderValue', direction: 'desc' }], limit: 10 },
  'derived-by-grain-with-offset': { by: 'month', measures: ['averageOrderValue'], offset: 20 },
  'having': {
    dimensions: ['customerId'],
    measures: ['revenue', 'averageOrderValue'],
    having: [
      { measure: 'revenue', operator: 'gt', value: 100 },
      { measure: 'averageOrderValue', operator: 'between', value: [10, 50] },
    ],
  },
  'timezone-new-york': { by: 'day', measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-01-02' }], timezone: 'America/New_York' },
  'window-trailing-and-to-date': { by: 'day', dimensions: ['status'], measures: ['revenue', 'rolling', 'rollingBuyers', 'monthToDate'], filters: RANGE },
  'window-cumulative': { by: 'week', measures: ['running', 'runningOrders'], filters: RANGE, timezone: 'Europe/Berlin' },
  'window-exclusive-bounds': {
    by: 'day', measures: ['rolling'],
    filters: [{ field: 'createdAt', operator: 'gt', value: '2026-01-01' }, { field: 'createdAt', operator: 'lt', value: '2026-04-01' }],
  },
  'shift-calendar-and-derived': { by: 'day', dimensions: ['region'], measures: ['revenue', 'priorYear', 'priorMonth', 'yearOverYear'], filters: RANGE },
  'shift-wall-time-guard': { by: 'hour', measures: ['priorHour', 'priorMonth'], filters: HOUR_RANGE, timezone: 'America/New_York' },
  'composite-shifted-formula': { by: 'month', dimensions: ['status'], measures: ['priorAov', 'averageOrderValue'], filters: RANGE },
  'composite-window-formula': { by: 'day', measures: ['rollingShare'], filters: RANGE },
  'composite-cumulative-nested-formula': { by: 'day', dimensions: ['status'], measures: ['runningAovRounded'], filters: RANGE },
  'composite-to-date-nested-formula': { by: 'day', measures: ['monthToDateShareRounded'], filters: RANGE, timezone: 'Asia/Tokyo' },
  'window-analytical-aggregates-with-limit': { by: 'day', measures: ['rollingP95', 'rollingTop'], filters: RANGE, limit: 500 },
};
for (const grain of GRAINS) {
  datasetCases[`grain-${grain}`] = { by: grain, dimensions: ['status'], measures: ['revenue'] };
}

function golden(compilation: { sql: string; parameters: readonly unknown[]; preflightStatements?: readonly { sql: string; parameters: readonly unknown[] }[] }): string {
  const sections = [`-- sql\n${compilation.sql}`, `-- parameters\n${JSON.stringify(compilation.parameters)}`];
  for (const [index, statement] of (compilation.preflightStatements ?? []).entries()) {
    sections.push(`-- preflight ${index}\n${statement.sql}`, `-- preflight ${index} parameters\n${JSON.stringify(statement.parameters)}`);
  }
  return `${sections.join('\n\n')}\n`;
}

describe('golden datasets SQL (ClickHouse)', () => {
  it.each(Object.entries(datasetCases))('dataset %s', async (name, query) => {
    const compilation = client.compileDataset(Orders, query as never, TENANT);
    await expect(golden(compilation)).toMatchFileSnapshot(`./golden-sql/dataset-${name}.sql`);
  });

  it.each(Object.entries(metrics))('metric %s', async (name, metric) => {
    const sql = client.toSQL(metric as never, { dimensions: ['status'], limit: 5 } as never, TENANT);
    await expect(`-- sql\n${sql}\n`).toMatchFileSnapshot(`./golden-sql/metric-${name}.sql`);
  });

  it('the corpus covers every emission plan', () => {
    const plans = new Set(Object.values(datasetCases).map(query => client.compileDataset(Orders, query as never, TENANT).describe().plan));
    expect([...plans].sort()).toEqual(['aggregate', 'derived', 'time']);
  });
});
