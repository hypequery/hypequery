/**
 * Golden Postgres SQL for every datasets emission path Postgres supports,
 * compiled through the real Postgres builder. The cases mirror the
 * ClickHouse corpus case for case, so the two directories diff side by
 * side. Regenerate deliberately with `vitest -u`; a diff is a behaviour
 * change.
 */
import { describe, expect, it } from 'vitest';
import { createDatasetClient, type MetricHandle, type TimeGrain } from '@hypequery/datasets';
import { divide, nullIfZero, round } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '../index.js';
import { Orders, TENANT } from './fixtures.js';
import { datasetCases } from './cases.js';

const client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder() });
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

function golden(compilation: { sql: string; parameters: readonly unknown[]; preflightStatements?: readonly { sql: string; parameters: readonly unknown[] }[] }): string {
  const sections = [`-- sql\n${compilation.sql}`, `-- parameters\n${JSON.stringify(compilation.parameters)}`];
  for (const [index, statement] of (compilation.preflightStatements ?? []).entries()) {
    sections.push(`-- preflight ${index}\n${statement.sql}`, `-- preflight ${index} parameters\n${JSON.stringify(statement.parameters)}`);
  }
  return `${sections.join('\n\n')}\n`;
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

});
