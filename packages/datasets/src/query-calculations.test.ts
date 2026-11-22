import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from './index.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { datasetCacheKey } from './cache/protocol-cache-keys.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetQuery } from './types.js';

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

  it('ranks and shares over the grouped rows before having, and bounds Top-N per group', () => {
    const sql = recordingClient().client.toSQL({ ...Orders, limits: undefined }, {
      by: 'month', dimensions: ['country'], measures: ['revenue', 'users'], filters: RANGE,
      calculations: [
        { name: 'r', rank: { measure: 'revenue', within: ['period'] } },
        { name: 's', share: { measure: 'revenue', of: ['period'] } },
        { name: 'u', share: { measure: 'users', of: ['period'] } },
      ],
      having: [{ measure: 'r', operator: 'lte', value: 3 }],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limitBy: { n: 2, by: ['period'] },
    }, TENANT);
    expect(sql).toContain('rank() OVER (PARTITION BY `_hq_calc`.`period` ORDER BY `_hq_calc`.`revenue` DESC NULLS LAST) AS `_hq_calc_0`');
    expect(sql).toContain('`_hq_calc`.`revenue` / NULLIF(sum(`_hq_calc`.`revenue`) OVER (PARTITION BY `_hq_calc`.`period`), 0) AS `_hq_calc_1`');
    // countDistinct is re-aggregated at the coarser grain and joined, NULL keys matching.
    expect(sql).toContain('LEFT JOIN (SELECT `period`, `users` AS `_hq_total`');
    expect(sql).toContain('isNotDistinctFrom(`_hq_calc`.`period`, `_hq_share__hq_calc_2`.`period`)');
    expect(sql).toMatch(/WHERE `_hq_calc_0` <= \? ORDER BY `revenue` DESC LIMIT 2 BY `period`$/);
  });

  it('regroups other from source rows through a top-N CTE, leaving filters on source values', () => {
    const sql = recordingClient().client.toSQL(Orders, {
      dimensions: ['country'], measures: ['users'],
      filters: [{ field: 'country', operator: 'neq', value: 'ES' }],
      other: { dimension: 'country', n: 3, measure: 'revenue', label: "Rest o'world" },
    }, TENANT);
    expect(sql).toMatch(/^WITH `_hq_other_top` AS \(SELECT `country` FROM .+ WHERE `country` IS NOT NULL ORDER BY `revenue` DESC, `country` ASC LIMIT 3\)/);
    expect(sql).toContain("if(orders.country IN (SELECT `country` FROM `_hq_other_top`), orders.country, 'Rest o''world') AS `country`");
    expect(sql).toContain('orders.country != ?');
  });

  it.each([
    ['other on a non-string dimension', { dimensions: ['amount'], measures: ['revenue'], other: { dimension: 'amount', n: 2, measure: 'revenue' } }, /groups a string dimension/],
    ['other ranked by a window measure', { dimensions: ['country'], measures: ['revenue'], other: { dimension: 'country', n: 2, measure: 'revenueRunning' } }, /depends on a shift or window/],
    ['a non-additive share of a time measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }, { name: 's', share: { measure: 'revenue_change_pct' } }] }, /not additive and depends on a shift or window/],
    ['limitBy without orderBy', { dimensions: ['country'], measures: ['revenue'], limitBy: { n: 2, by: ['country'] } }, /limitBy requires a non-empty orderBy/],
  ] as const)('refuses %s by name', (_name, query, message) => {
    expect(errors(query as DatasetQuery).join('\n')).toMatch(message);
  });

  it('runs uncached and refuses the backend path', async () => {
    const query: DatasetQuery = { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: WEB } }] };
    expect(datasetCacheKey({ secret: new Uint8Array(32), namespace: 'test' } as never, Orders, query, TENANT, undefined)).toBeUndefined();
    const client = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
    await expect(Promise.resolve().then(() => client.execute(Orders, query, TENANT))).rejects.toThrow(/queryBuilder execution path/);
  });
});
