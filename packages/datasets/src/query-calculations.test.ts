import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from './index.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { datasetCacheKey } from './cache/protocol-cache-keys.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetQuery } from './types.js';
import { formulaMeasure } from './utils/query-calculation-formula.js';
import { calculationColumns } from './utils/query-calculation-outputs.js';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'createdAt',
  dimensions: {
    country: dimension.string(),
    channel: dimension.string(),
    userId: dimension.string({ column: 'user_id' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('userId'),
    users: measure.countDistinct('userId'),
    latest: measure.argMax('amount', 'createdAt'),
    revenueRunning: measure.cumulative('revenue'),
  },
  limits: { maxFilters: 3, maxMeasures: 4 },
});

const TENANT = { runtime: { tenant: { id: 't1' } } } as const;
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];
const WEB = [{ field: 'channel', operator: 'eq' as const, value: 'web' }];

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

const errors = (query: DatasetQuery) => recordingClient().client.validate(Orders, query, TENANT).errors;

describe('RFC 0026 calculations in the dataset client', () => {
  it('plans calculations under reserved names and renames them in an outer stage', async () => {
    const { client, calls } = recordingClient();
    const query: DatasetQuery = {
      dimensions: ['country'], measures: ['revenue'],
      calculations: [{ name: 'web_revenue', filter: { measure: 'revenue', where: WEB } }],
      having: [{ measure: 'web_revenue', operator: 'gt', value: 10 }],
      orderBy: [{ field: 'web_revenue', direction: 'desc' }],
      limit: 5,
    };
    const sql = client.toSQL(Orders, query, TENANT);
    expect(sql).toContain("SUM(if((orders.channel = 'web'), orders.amount, 0)) AS `_hq_calc_0`");
    expect(sql).toMatch(/^SELECT `country`, `revenue`, `_hq_calc_0` AS `web_revenue` FROM \(/);
    expect(sql).toContain('WHERE `_hq_calc_0` > ? ORDER BY `_hq_calc_0` DESC LIMIT 5');
    const result = await client.execute(Orders, query, TENANT);
    expect(calls[0].params).toEqual(['t1', 10]);
    expect(result.meta.calculations).toEqual([
      { name: 'web_revenue', kind: 'filter', calculation: 'web_revenue', measure: 'revenue', type: 'number' },
    ]);
    expect(client.compileDataset(Orders, query, TENANT).describe().calculations).toEqual(['web_revenue']);
  });

  it('lets a calculation take the name of a measure the query does not select', () => {
    const sql = recordingClient().client.toSQL(Orders, {
      measures: ['revenue'], calculations: [{ name: 'users', filter: { measure: 'revenue', where: WEB } }],
    }, TENANT);
    expect(sql).toContain('`_hq_calc_0` AS `users`');
    expect(sql).not.toContain('uniqExact');
  });

  it('accepts having on a time-measure calculation through the outer stage', () => {
    const sql = recordingClient().client.toSQL(Orders, {
      by: 'month', measures: ['revenue'], filters: RANGE,
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
      having: [{ measure: 'revenue_change_pct', operator: 'gt', value: 0.1 }],
    }, TENANT);
    expect(sql).toContain('`_hq_calc_0_0_change_pct` AS `revenue_change_pct`');
    expect(sql).toContain('WHERE `_hq_calc_0_0_change_pct` > ?');
  });

  it('checks calculation names and inputs against the default measure selection', () => {
    // Omitting `measures` selects every base measure, so a calculation cannot
    // take one of their names, and a formula may read any of them.
    expect(errors({ calculations: [{ name: 'users', filter: { measure: 'revenue', where: WEB } }] }).join('\n'))
      .toMatch(/HQ_EXPRESSION_INVALID_QUERY/);
    const Unlimited = dataset('unlimited', {
      source: 'orders', tenantKey: 'tenant_id',
      dimensions: { userId: dimension.string({ column: 'user_id' }), amount: dimension.number() },
      measures: { revenue: measure.sum('amount'), users: measure.countDistinct('userId') },
    });
    const sql = recordingClient().client.toSQL(Unlimited, {
      calculations: [{ name: 'per_user', formula: { op: 'divide', args: ['revenue', { op: 'nullIfZero', args: ['users'] }] } }],
    }, TENANT);
    expect(sql).toMatch(/^SELECT `revenue`, `users`, `_hq_calc_0` AS `per_user` FROM \(/);
  });

  it('keeps the caller\'s limit as the exact time-series budget of an unpaged inner statement', () => {
    const sql = recordingClient().client.toSQL(Orders, {
      by: 'day', measures: ['revenue'], limit: 10,
      filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-01-12'] }],
      calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'day' } }],
    }, TENANT);
    expect(sql).toContain('exceeds the effective result limit of 10 buckets');
    // Only the outer stage pages the rows.
    expect(sql.match(/LIMIT 10/g)).toHaveLength(1);
    expect(sql).toMatch(/LIMIT 10$/);
  });

  it.each([-1, 1.5])('refuses offset %s before building any SQL', offset => {
    expect(errors({
      measures: ['revenue'], offset,
      calculations: [{ name: 'x', filter: { measure: 'revenue', where: WEB } }],
    })).toContain('Invalid offset: expected a non-negative integer.');
  });

  it.each([
    ['an unknown measure', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'nope', where: WEB } }] }, /unknown measure "nope"/],
    ['an argMax filter', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'latest', where: WEB } }] }, /argMax measures do not accept filters/],
    ['a filter of a window measure', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenueRunning', where: WEB } }] }, /must filter a base measure/],
    ['an unfilterable field', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ field: 'nope', operator: 'eq', value: 1 }] } }] }, /Unknown filter fields: nope/],
    ['a time field condition', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ field: 'createdAt', operator: 'gt', value: '2026-01-01' }] } }] }, /cannot compare time field/],
    ['a wrongly typed value', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [{ field: 'amount', operator: 'eq', value: 'ten' }] } }] }, /amount/],
    ['a formula over an unselected measure', { measures: ['revenue'], calculations: [{ name: 'x', formula: { op: 'divide', args: ['revenue', 'users'] } }] }, /HQ_EXPRESSION_INVALID_QUERY/],
    ['a shift of a shift', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' } }, { name: 'pp', shift: { measure: 'p', amount: 1, unit: 'month' } }] }, /HQ_EXPRESSION_INVALID_QUERY/],
    ['a cumulative countDistinct', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'u', window: { measure: 'users', cumulative: true } }] }, /window measure "u" cannot accumulate countDistinct/],
    ['a shift without a bounded range', { by: 'month', measures: ['revenue'], calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' } }] }, /bounded time range/],
    ['a shift across partial buckets', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 10, unit: 'day' } }] }, /Shift measure "p" must span whole "month" buckets/],
    ['an unknown orderBy output', { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: WEB } }], orderBy: [{ field: 'y', direction: 'asc' }] }, /Unknown orderBy fields: y/],
    ['too many outputs', { measures: ['revenue', 'orders'], calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }], by: 'month', filters: RANGE }, /Too many measures and calculation outputs: 5 \(max 4\)/],
    ['too many predicates', { measures: ['revenue'], filters: [...RANGE, ...WEB], calculations: [{ name: 'x', filter: { measure: 'revenue', where: [...WEB, ...WEB] } }] }, /Too many filters, having conditions and filter-calculation conditions: 4 \(max 3\)/],
  ] as const)('refuses %s by name', (_name, query, message) => {
    expect(errors(query as DatasetQuery).join('\n')).toMatch(message);
  });

  it.each([
    ['a shift of an unknown measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'p', shift: { measure: 'nope', amount: 1, unit: 'month' } }] }, /reads unknown measure "nope"/],
    ['a shift of a window measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'p', shift: { measure: 'revenueRunning', amount: 1, unit: 'month' } }] }, /cannot shift "revenueRunning", which already depends/],
    ['a window of an unknown measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'w', window: { measure: 'nope', cumulative: true } }] }, /reads unknown measure "nope"/],
    ['a window of a window measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'w', window: { measure: 'revenueRunning', cumulative: true } }] }, /must window a base measure/],
    ['a formula over an unknown selected measure', { measures: ['revenue', 'nope'], calculations: [{ name: 'f', formula: { op: 'multiply', args: ['nope', 2] } }] }, /reads unknown measure "nope"/],
    ['a compare of an unknown selected measure', { by: 'month', measures: ['nope'], filters: RANGE, calculations: [{ name: 'c', compare: { to: 'previousPeriod', measures: ['nope'] } }] }, /reads unknown measure "nope"/],
    ['a compare of a window measure', { by: 'month', measures: ['revenueRunning'], filters: RANGE, calculations: [{ name: 'c', compare: { to: 'previousPeriod', measures: ['revenueRunning'] } }] }, /cannot compare "revenueRunning", which already depends/],
    ['limitBy without orderBy', { dimensions: ['country'], measures: ['revenue'], limitBy: { n: 2, by: ['country'] } }, /limitBy requires a non-empty orderBy/],
  ] as const)('refuses %s by name, in the caller\'s words', (_name, query, message) => {
    expect(errors(query as DatasetQuery).join('\n')).toMatch(message);
  });

  it('reports planner errors under the caller\'s names', () => {
    // A shift that cannot span whole buckets fails in the time planner, which
    // only knows the internal names.
    const message = errors({
      by: 'month', measures: ['revenue'], filters: RANGE,
      calculations: [
        { name: 'web', filter: { measure: 'revenue', where: WEB } },
        { name: 'late', shift: { measure: 'web', amount: 10, unit: 'day' } },
      ],
    }).join('\n');
    expect(message).toContain('Shift measure "late"');
    expect(message).not.toContain('_hq_calc_');
  });

  it('refuses a dataset that already uses the reserved calculation prefix', () => {
    const Reserved = dataset('reserved', {
      source: 'reserved', dimensions: { x: dimension.string() },
      measures: { _hq_calc_0: measure.count('x') },
    });
    expect(recordingClient().client.validate(Reserved, {
      measures: ['_hq_calc_0'], calculations: [{ name: 'y', formula: { op: 'multiply', args: ['_hq_calc_0', 2] } }],
    }).errors.join('\n')).toMatch(/prefix is reserved/);
  });

  it('refuses kinds this release does not run, by name', () => {
    expect(() => recordingClient().client.toSQL(Orders, {
      dimensions: ['country'], measures: ['revenue'], calculations: [{ name: 'r', rank: { measure: 'revenue' } }],
    }, TENANT)).toThrow(/"rank" calculations are not supported/);
  });

  it('types rank and share outputs from the query alone', () => {
    expect(calculationColumns({
      calculations: [
        { name: 'r', rank: { measure: 'revenue' } },
        { name: 's', share: { measure: 'revenue', of: [] } },
        { name: 'g', formula: { op: 'percentChange', args: ['revenue', 'r'] } },
        { name: 'bad' } as never,
      ],
    })).toEqual([
      { name: 'r', kind: 'rank', calculation: 'r', measure: 'revenue', type: 'integer' },
      { name: 's', kind: 'share', calculation: 's', measure: 'revenue', type: 'number', format: 'ratio' },
      { name: 'g', kind: 'formula', calculation: 'g', type: 'number', format: 'ratio' },
    ]);
  });

  it('gives formula calculations a generic toSQL rendering', () => {
    const definition = formulaMeasure({
      op: 'round',
      args: [{ op: 'percentChange', args: ['a', { op: 'nullIfZero', args: ['b'] }] }, 2],
    }, name => name);
    expect(definition.formula({ a: 'a', b: 'b' } as never).toSQL()).toBe('ROUND(((a) - (NULLIF(b, 0))) / (NULLIF(NULLIF(b, 0), 0)), 2)');
  });

  it('runs uncached and refuses the backend path', async () => {
    const query: DatasetQuery = { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: WEB } }] };
    expect(datasetCacheKey({ secret: new Uint8Array(32), namespace: 'test' } as never, Orders, query, TENANT, undefined)).toBeUndefined();
    const client = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
    await expect(Promise.resolve().then(() => client.execute(Orders, query, TENANT))).rejects.toThrow(/queryBuilder execution path/);
  });
});
