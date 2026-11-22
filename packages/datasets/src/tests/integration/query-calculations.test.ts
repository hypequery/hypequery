/**
 * RFC 0026 filter, shift, window, formula and compare calculations against
 * ClickHouse, over the draft execution rows in
 * specs/security-protocol/drafts/query-calculations-v1/rows.json.
 *
 * Two independent checks per kind: the calculation returns exactly what the
 * equivalent model-level measure returns (same planner, same SQL semantics),
 * and pinned values agree with a brute-force evaluation over the raw rows.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { divide, nullIfZero, subtract } from '../../formulas.js';
import type { DatasetQuery } from '../../types.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

interface OrderRow {
  tenant: string; id: number; created_at: string; country: string | null; channel: string; user_id: string; amount: number;
}
const fixture = JSON.parse(readFileSync(new URL(
  '../../../../../specs/security-protocol/drafts/query-calculations-v1/rows.json', import.meta.url,
), 'utf8')) as { rows: OrderRow[]; range: [string, string] };

const table = 'hq_rfc0026_orders';
const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database,
});
const client = createDatasetClient({ queryBuilder: db });
const context = { runtime: { tenant: { id: 'a' } } };

const dimensions = {
  created_at: dimension.timestamp(), country: dimension.string(), channel: dimension.string(),
  user_id: dimension.string(), id: dimension.number(),
};
const baseMeasures = {
  revenue: measure.sum('amount'), orders: measure.count('id'), users: measure.countDistinct('user_id'),
  avg_order: measure.avg('amount'), largest: measure.max('amount'),
};
const Orders = dataset('calcOrders', { source: table, timeKey: 'created_at', tenantKey: 'tenant', dimensions, measures: baseMeasures });
const web = [{ field: 'channel', operator: 'eq' as const, value: 'web' }];
/** The same measures, declared in the model: what each calculation must reproduce. */
const Model = dataset('calcOrdersModel', {
  source: table, timeKey: 'created_at', tenantKey: 'tenant', dimensions,
  measures: {
    ...baseMeasures,
    web_revenue: measure.sum('amount', { filters: web }),
    web_users: measure.countDistinct('user_id', { filters: web }),
    revenue_last_year: measure.shift('revenue', { amount: 1, unit: 'year' }),
    revenue_previous: measure.shift('revenue', { amount: 1, unit: 'month' }),
    revenue_2m: measure.trailing('revenue', { amount: 2, unit: 'month' }),
    revenue_ytd: measure.toDate('revenue', 'year'),
    revenue_running: measure.cumulative('revenue'),
    web_running: measure.cumulative('web_revenue'),
    aov: measure.derived({ uses: { r: 'revenue', o: 'orders' }, formula: ({ r, o }) => divide(r, nullIfZero(o)) }),
    revenue_change: measure.derived({ uses: { r: 'revenue', p: 'revenue_previous' }, formula: ({ r, p }) => subtract(r, p) }),
    revenue_change_pct: measure.derived({
      uses: { r: 'revenue', p: 'revenue_previous' }, formula: ({ r, p }) => divide(subtract(r, p), nullIfZero(p)),
    }),
  },
});
const range = [
  { field: 'created_at', operator: 'gte' as const, value: fixture.range[0] },
  { field: 'created_at', operator: 'lt' as const, value: fixture.range[1] },
];

const tenantRows = fixture.rows.filter(row => row.tenant === 'a');
const inRange = (row: OrderRow) => row.created_at >= '2026-01-01' && row.created_at < '2026-05-01';
const month = (row: OrderRow) => row.created_at.slice(0, 7);
const sum = (rows: OrderRow[]) => (rows.length === 0 ? null : rows.reduce((total, row) => total + row.amount, 0));
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04'];
const numeric = (value: unknown) => (value === null ? null : Number(value));
const columns = (rows: readonly Record<string, unknown>[], names: readonly string[]) => (
  rows.map(row => names.map(name => (name === 'period' || name === 'country' ? row[name] : numeric(row[name]))))
);
const execute = (query: DatasetQuery) => client.execute(Orders, query, context);
const model = (query: DatasetQuery) => client.execute(Model, query, context);

describe('RFC 0026 calculations against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql(`CREATE TABLE ${table} (tenant String, id UInt32, created_at DateTime64(3, 'UTC'), country Nullable(String), `
      + 'channel String, user_id String, amount Float64) ENGINE = MergeTree ORDER BY (tenant, id)');
    await insertRows(table, fixture.rows);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${table}`); });

  it('filter: a conditional aggregate, equal to the model-level filtered measure', async () => {
    const query = { dimensions: ['country'], measures: ['revenue'], orderBy: [{ field: 'country', direction: 'asc' as const }] };
    const result = await execute({ ...query, calculations: [{ name: 'web_revenue', filter: { measure: 'revenue', where: web } }] });
    const expected = await model({ ...query, measures: ['revenue', 'web_revenue'] });
    expect(result.data).toEqual(expected.data);
    const countries = [...new Set(tenantRows.map(row => row.country))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    expect(columns(result.data, ['country', 'web_revenue']).sort()).toEqual(countries.map(country => {
      const webRows = tenantRows.filter(row => row.country === country && row.channel === 'web');
      return [country, webRows.reduce((total, row) => total + row.amount, 0)];
    }).sort());
    expect(result.meta.calculations).toEqual([
      { name: 'web_revenue', kind: 'filter', calculation: 'web_revenue', measure: 'revenue', type: 'number' },
    ]);
  });

  it('filter: countDistinct over a filtered population, by month with gap fill', async () => {
    const query = { by: 'month' as const, measures: ['users'], filters: range };
    const result = await execute({ ...query, calculations: [{ name: 'web_users', filter: { measure: 'users', where: web } }] });
    const expected = await model({ ...query, measures: ['users', 'web_users'] });
    expect(result.data).toEqual(expected.data);
    expect(columns(result.data, ['web_users'])).toEqual(MONTHS
      .map(m => tenantRows.filter(row => month(row) === m && row.channel === 'web'))
      .filter(rows => rows.length > 0)
      .map(rows => [new Set(rows.map(row => row.user_id)).size]));
  });

  it('shift: the same bucket a year earlier, equal to a model shift measure', async () => {
    const query = { by: 'month' as const, measures: ['revenue'], filters: range };
    const result = await execute({ ...query, calculations: [{ name: 'revenue_last_year', shift: { measure: 'revenue', amount: 1, unit: 'year' } }] });
    const expected = await model({ ...query, measures: ['revenue', 'revenue_last_year'] });
    expect(result.data).toEqual(expected.data);
    expect(columns(result.data, ['revenue', 'revenue_last_year'])).toEqual(MONTHS.map(m => [
      sum(tenantRows.filter(row => month(row) === m)),
      sum(tenantRows.filter(row => month(row) === `2025-${m.slice(5)}`)),
    ]));
  });

  it('window: trailing, to-date and cumulative, including a window over a filter calculation', async () => {
    const query = { by: 'month' as const, measures: ['revenue'], filters: range };
    const result = await execute({ ...query, calculations: [
      { name: 'revenue_2m', window: { measure: 'revenue', trailing: { amount: 2, unit: 'month' } } },
      { name: 'revenue_ytd', window: { measure: 'revenue', toDate: 'year' } },
      { name: 'revenue_running', window: { measure: 'revenue', cumulative: true } },
      { name: 'web_revenue', filter: { measure: 'revenue', where: web } },
      { name: 'web_running', window: { measure: 'web_revenue', cumulative: true } },
    ] });
    const expected = await model({
      ...query, measures: ['revenue', 'revenue_2m', 'revenue_ytd', 'revenue_running', 'web_revenue', 'web_running'],
    });
    expect(result.data).toEqual(expected.data);
    // Cumulative windows accumulate from the start of the data, not of the range.
    let running = sum(tenantRows.filter(row => row.created_at < '2026-01-01')) ?? 0;
    expect(columns(result.data, ['revenue_running'])).toEqual(MONTHS.map(m => {
      running += sum(tenantRows.filter(row => month(row) === m && inRange(row))) ?? 0;
      return [running];
    }));
  });

  it('formula: arithmetic over selected measures and earlier calculations', async () => {
    const query = { dimensions: ['country'], measures: ['revenue', 'orders'], orderBy: [{ field: 'country', direction: 'asc' as const }] };
    const result = await execute({ ...query, calculations: [
      { name: 'aov', formula: { op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['orders'] }] } },
      { name: 'aov_cents', formula: { op: 'round', args: [{ op: 'multiply', args: ['aov', 100] }, 0] } },
    ] });
    const expected = await model({ ...query, measures: ['revenue', 'orders', 'aov'] });
    expect(result.data.map(({ aov_cents: _cents, ...row }) => row)).toEqual(expected.data);
    for (const row of result.data) {
      const rows = tenantRows.filter(order => order.country === row.country);
      expect(numeric(row.aov_cents)).toBe(Math.round((sum(rows)! / rows.length) * 100));
    }
  });

  it('compare previousPeriod: previous, change and change_pct, with having on a calculation', async () => {
    const query = { by: 'month' as const, measures: ['revenue'], filters: range };
    const result = await execute({ ...query, calculations: [{ name: 'vs_prior', compare: { to: 'previousPeriod', measures: ['revenue'] } }] });
    const expected = await model({ ...query, measures: ['revenue', 'revenue_previous', 'revenue_change', 'revenue_change_pct'] });
    expect(result.data).toEqual(expected.data);
    const monthly = MONTHS.map(m => sum(tenantRows.filter(row => month(row) === m)));
    const previous = [sum(tenantRows.filter(row => month(row) === '2025-12')), ...monthly.slice(0, 3)];
    expect(columns(result.data, ['revenue', 'revenue_previous'])).toEqual(monthly.map((value, index) => [value, previous[index]]));
    expect(result.meta.calculations?.map(column => [column.name, column.kind, column.format])).toEqual([
      ['revenue_previous', 'shift', undefined], ['revenue_change', 'formula', undefined], ['revenue_change_pct', 'formula', 'ratio'],
    ]);

    const growing = await execute({
      ...query, calculations: [{ name: 'vs_prior', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
      having: [{ measure: 'revenue_change_pct', operator: 'gt', value: 0 }],
      orderBy: [{ field: 'revenue_change', direction: 'desc' }],
    });
    expect(growing.data.map(row => row.period)).toEqual(
      expected.data.filter(row => numeric(row.revenue_change_pct)! > 0)
        .sort((a, b) => numeric(b.revenue_change)! - numeric(a.revenue_change)!)
        .map(row => row.period),
    );
  });

  it('compare previousYear by quarter, per country', async () => {
    const result = await execute({
      by: 'quarter', dimensions: ['country'], measures: ['revenue'],
      filters: range, calculations: [{ name: 'yoy', compare: { to: 'previousYear', measures: ['revenue'] } }],
      orderBy: [{ field: 'period', direction: 'asc' }, { field: 'country', direction: 'asc' }],
    });
    const q1 = result.data.filter(row => String(row.period).startsWith('2026-01'));
    const us = q1.find(row => row.country === 'US')!;
    // Q1 2026: orders 3, 4 and 9; Q1 2025: order 1.
    expect([numeric(us.revenue), numeric(us.revenue_previous), numeric(us.revenue_change)]).toEqual([350, 100, 250]);
    expect(numeric(us.revenue_change_pct)).toBeCloseTo(2.5);
    const es = result.data.find(row => row.country === 'ES')!;
    expect([numeric(es.revenue_previous), es.revenue_change_pct]).toEqual([null, null]);
  });

  it('refuses what the planner cannot compute, by name', async () => {
    const execute = (query: DatasetQuery) => Promise.resolve().then(() => client.execute(Orders, query, context));
    await expect(execute({ measures: ['revenue'], calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' } }] }))
      .rejects.toThrow(/require "by"/);
    await expect(execute({ by: 'month', measures: ['revenue'], calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' } }] }))
      .rejects.toThrow(/bounded time range/);
    await expect(execute({ measures: ['users'], calculations: [{ name: 'u', window: { measure: 'users', cumulative: true } }], by: 'month', filters: range }))
      .rejects.toThrow(/cannot accumulate countDistinct/);
    await expect(execute({ dimensions: ['country'], measures: ['revenue'], calculations: [{ name: 'r', rank: { measure: 'revenue' } }] }))
      .rejects.toThrow(/"rank" calculations are not supported/);
  });
});
