/**
 * Golden Postgres SQL for every datasets emission path Postgres supports,
 * compiled through the real Postgres builder. The cases mirror the
 * ClickHouse corpus case for case, so the two directories diff side by
 * side. Regenerate deliberately with `vitest -u`; a diff is a behaviour
 * change.
 */
import { describe, expect, it } from 'vitest';
import { createDatasetClient, type DatasetQuery, type MetricHandle, type TimeGrain } from '@hypequery/datasets';
import { divide, nullIfZero, round } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '../index.js';
import { Orders, TENANT } from './fixtures.js';

const client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder() });
const GRAINS: TimeGrain[] = ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'];
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];

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
  'instant-filter': { measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-01-02T05:00:00Z' }], timezone: 'America/New_York' },
};
for (const grain of GRAINS) {
  datasetCases[`grain-${grain}`] = { by: grain, dimensions: ['status'], measures: ['revenue'] };
}

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
};

function golden(compilation: { sql: string; parameters: readonly unknown[] }): string {
  return `-- sql\n${compilation.sql}\n\n-- parameters\n${JSON.stringify(compilation.parameters)}\n`;
}

describe('golden datasets SQL (Postgres)', () => {
  it.each(Object.entries(datasetCases))('dataset %s', async (name, query) => {
    const compilation = client.compileDataset(Orders, query as never, TENANT);
    await expect(golden(compilation)).toMatchFileSnapshot(`./golden-sql/dataset-${name}.sql`);
  });

  it.each(Object.entries(metrics))('metric %s', async (name, metric) => {
    const sql = client.toSQL(metric as never, { dimensions: ['status'], limit: 5 } as never, TENANT);
    await expect(`-- sql\n${sql}\n`).toMatchFileSnapshot(`./golden-sql/metric-${name}.sql`);
  });

  it.each([
    ['trailing', 'rolling'],
    ['shift', 'priorMonth'],
    ['cumulative', 'running'],
  ])('refuses %s time measures with a clear error', (_kind, measureName) => {
    expect(() => client.compileDataset(Orders, { by: 'day', measures: [measureName], filters: RANGE } as never, TENANT))
      .toThrow(/Time measures .* are not supported on Postgres yet/);
  });
});
