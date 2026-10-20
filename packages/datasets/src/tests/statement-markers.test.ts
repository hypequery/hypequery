/**
 * Statement markers (specs/datasets/0001) must never escape compilation:
 * every public SQL surface and every adapter call sees rendered SQL only.
 */

import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../clickhouse/src/index.js';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import type { DatasetQuery, MetricHandle } from '../types.js';
import { clickhouseDatasetSqlDialect } from '../utils/clickhouse-dataset-sql-dialect.js';
import { StatementParameters } from '../utils/statement-parameters.js';

const MARKER = /[\uE000\uE001]/;

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    status: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    prior: measure.shift('aov', { amount: 1, unit: 'month' }),
  },
});
const Aov = Orders.metric('aovMetric', {
  uses: { revenue: Orders.metric('r', { measure: 'revenue' }), orders: Orders.metric('o', { measure: 'orders' }) },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
}) as MetricHandle;

const TENANT = { runtime: { tenant: { id: 'acme' } } } as const;
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-02-01'] }];
const queries: Record<string, DatasetQuery> = {
  derived: { dimensions: ['status'], measures: ['aov'] },
  having: { dimensions: ['status'], measures: ['revenue'], having: [{ measure: 'revenue', operator: 'in', value: [1, 2] }] },
  window: { by: 'day', measures: ['rolling'], filters: RANGE },
  composite: { by: 'month', measures: ['prior'], filters: RANGE },
};

function recordingClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [] as T[];
      },
    },
  });
  return { calls, client: createDatasetClient({ queryBuilder: db }) };
}

describe('statement markers never escape compilation', () => {
  it('detects a live marker', () => {
    expect(new StatementParameters(clickhouseDatasetSqlDialect).bind(1)).toMatch(MARKER);
  });

  it.each(Object.entries(queries))('%s: compilation, toSQL, execution and adapter calls', async (_name, query) => {
    const { calls, client } = recordingClient();
    const compilation = client.compileDataset(Orders, query as never, TENANT);
    const surfaces = [
      compilation.sql,
      JSON.stringify(compilation.parameters),
      ...compilation.preflightStatements.flatMap(statement => [statement.sql, JSON.stringify(statement.parameters)]),
      client.toSQL(Orders, query as never, TENANT),
      JSON.stringify(compilation.describe()),
    ];
    const result = await client.execute(Orders, query as never, TENANT);
    surfaces.push(result.meta.sql ?? '');
    for (const call of calls) surfaces.push(call.sql, JSON.stringify(call.params));
    expect(calls.length).toBeGreaterThan(0);
    for (const surface of surfaces) expect(surface).not.toMatch(MARKER);
    expect(compilation.parameters).toContain('acme');
  });

  it('derived metrics: toSQL and execution', async () => {
    const { calls, client } = recordingClient();
    const sql = client.toSQL(Aov as never, { dimensions: ['status'] } as never, TENANT);
    const result = await client.execute(Aov as never, { dimensions: ['status'] } as never, TENANT);
    expect(sql).toContain('WITH base AS (');
    for (const surface of [sql, result.meta.sql ?? '', ...calls.map(call => call.sql)]) expect(surface).not.toMatch(MARKER);
    expect(calls[0].params).toEqual(['acme']);
  });

  it('binds having values after the embedded base query, in text order', () => {
    const { client } = recordingClient();
    const compilation = client.compileDataset(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
      having: [{ measure: 'revenue', operator: 'between', value: [10, 20] }],
    } as never, TENANT);
    expect(compilation.parameters).toEqual(['acme', 'paid', 10, 20]);
    expect(compilation.sql.match(/\?/g)).toHaveLength(4);
  });
});
