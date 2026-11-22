import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from './index.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { datasetCacheKey } from './cache/protocol-cache-keys.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetQuery } from './types.js';
import { formulaMeasure } from './utils/query-calculation-formula.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';
import { defineDatasetSqlDialectRules } from './utils/dataset-sql-dialect.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
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
    expect(sql).toContain('(toFloat64(`_hq_calc`.`revenue`) / NULLIF(sum(`_hq_calc`.`revenue`) OVER (PARTITION BY `_hq_calc`.`period`), 0)) AS `_hq_calc_1`');
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
    ['other ranked by an unknown measure', { dimensions: ['country'], measures: ['revenue'], other: { dimension: 'country', n: 2, measure: 'nope' } }, /ranks by unknown measure "nope"/],
    ['other beside a relationship field', { dimensions: ['country'], measures: ['revenue'], filters: [{ field: 'customer.tier', operator: 'eq', value: 'gold' }], other: { dimension: 'country', n: 2, measure: 'revenue' } }, /cannot be combined with relationship fields/],
    ['other beside a relationship field inside a filter group', { dimensions: ['country'], measures: ['revenue'], filters: [{ or: [...WEB, { not: { field: 'customer.tier', operator: 'eq', value: 'gold' } }] }], other: { dimension: 'country', n: 2, measure: 'revenue' } }, /cannot be combined with relationship fields/],
    ['a rank of an unknown selected measure', { dimensions: ['country'], measures: ['nope'], calculations: [{ name: 'r', rank: { measure: 'nope' } }] }, /reads unknown measure "nope"/],
    ['a share of an unknown selected measure', { dimensions: ['country'], measures: ['nope'], calculations: [{ name: 's', share: { measure: 'nope' } }] }, /reads unknown measure "nope"/],
    ['other ranked by a window measure', { dimensions: ['country'], measures: ['revenue'], other: { dimension: 'country', n: 2, measure: 'revenueRunning' } }, /depends on a shift or window/],
    ['a non-additive share of a time measure', { by: 'month', measures: ['revenue'], filters: RANGE, calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }, { name: 's', share: { measure: 'revenue_change_pct' } }] }, /not additive and depends on a shift or window/],
    ['limitBy without orderBy', { dimensions: ['country'], measures: ['revenue'], limitBy: { n: 2, by: ['country'] } }, /limitBy requires a non-empty orderBy/],
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

  it('keeps an ordinary period dimension in a non-additive share\'s denominator', () => {
    const Sessions = dataset('sessions', {
      source: 'sessions', tenantKey: 'tenant_id',
      dimensions: { period: dimension.string(), country: dimension.string(), userId: dimension.string({ column: 'user_id' }) },
      measures: { users: measure.countDistinct('userId') },
    });
    const sql = recordingClient().client.toSQL(Sessions, {
      dimensions: ['period', 'country'], measures: ['users'],
      calculations: [{ name: 's', share: { measure: 'users', of: ['period'] } }],
    }, TENANT);
    expect(sql).toContain('LEFT JOIN (SELECT `period`, `users` AS `_hq_total` FROM (');
    expect(sql).toContain('ON isNotDistinctFrom(`_hq_calc`.`period`, `_hq_share__hq_calc_0`.`period`)');
    expect(sql).toContain('sessions.period AS `period`, COUNT(DISTINCT sessions.user_id) AS `users` FROM sessions WHERE sessions.tenant_id = ? GROUP BY `period`)');
  });

  it('gives the time planner\'s axis preflight the same top-N CTE as the main statement', () => {
    const compilation = recordingClient().client.compileDataset(Orders, {
      by: 'month', dimensions: ['country'], measures: ['revenue'], filters: RANGE,
      calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
      other: { dimension: 'country', n: 2, measure: 'revenue' },
    }, TENANT);
    expect(compilation.describe().plan).toBe('time');
    const [preflight] = compilation.preflightStatements;
    for (const statement of [compilation, preflight]) {
      expect(statement.sql).toMatch(/^WITH `_hq_other_top` AS \(SELECT `country` FROM /);
      expect(statement.sql).toContain('FROM `_hq_other_top`), orders.country');
    }
    // The preflight's own WITH list is read as a subquery under the CTE.
    expect(preflight.sql).toContain(') SELECT * FROM (WITH ');
    // The ranking binds its own tenancy in each statement.
    expect(preflight.parameters.filter(value => value === 't1').length).toBeGreaterThanOrEqual(2);
  });

  it('refuses limitBy, other and joined denominators on a dialect without them, by name', () => {
    const dialect = defineDatasetSqlDialectRules({ ...clickhouseDatasetSqlDialect, name: 'elsewhere' });
    const client = createDatasetClient({ queryBuilder: { ...createRenderingBuilderFactory(), datasetSqlDialect: dialect } });
    expect(() => client.toSQL(Orders, {
      dimensions: ['country'], measures: ['users'], orderBy: [{ field: 'users', direction: 'desc' }],
      limitBy: { n: 1, by: ['country'] },
      other: { dimension: 'country', n: 2, measure: 'revenue' },
      calculations: [{ name: 's', share: { measure: 'users' } }],
    }, TENANT)).toThrow(/"limitBy", "other", a share of a non-additive measure are not supported on the "elsewhere" dialect/);
    expect(() => client.toSQL(Orders, {
      dimensions: ['country'], measures: ['revenue'], other: { dimension: 'country', n: 2, measure: 'revenue' },
    }, TENANT)).toThrow(/"other" is not supported on the "elsewhere" dialect/);
    // Additive shares and ranks are window functions every dialect has.
    expect(client.toSQL(Orders, {
      dimensions: ['country'], measures: ['revenue'], calculations: [{ name: 's', share: { measure: 'revenue' } }],
    }, TENANT)).toContain('OVER ()');
  });

  it('runs uncached and refuses the backend path', async () => {
    const query: DatasetQuery = { measures: ['revenue'], calculations: [{ name: 'x', filter: { measure: 'revenue', where: WEB } }] };
    expect(datasetCacheKey({ secret: new Uint8Array(32), namespace: 'test' } as never, Orders, query, TENANT, undefined)).toBeUndefined();
    const client = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
    await expect(Promise.resolve().then(() => client.execute(Orders, query, TENANT))).rejects.toThrow(/queryBuilder execution path/);
  });

  describe('alongside RFC 0029 filters, fill and time keys', () => {
    const NOW = new Date('2026-11-22T10:00:00Z');
    function clockClient() {
      const db = createQueryBuilder({ adapter: { name: 'recording', async query<T>() { return [] as T[]; } } });
      return createDatasetClient({ queryBuilder: db, now: () => NOW });
    }
    const january = { field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-01-31'] };

    it('fills a series that carries a filter calculation, on the time-series planner', () => {
      const compilation = clockClient().compileDataset(Orders, {
        dimensions: ['country'], measures: ['revenue'], by: 'day', fill: true, filters: [january],
        calculations: [{ name: 'web_revenue', filter: { measure: 'revenue', where: WEB } }],
      }, TENANT);
      expect(compilation.describe().plan).toBe('time');
      expect(compilation.sql).toContain('_hq_series');
      expect(compilation.sql).toContain('`_hq_calc_0` AS `web_revenue`');
      expect(compilation.preflightStatements).toHaveLength(1);
    });

    it('bounds a compare with a relative range the client resolves', () => {
      const compilation = clockClient().compileDataset(Orders, {
        measures: ['revenue'], by: 'month',
        filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'this year' }],
        calculations: [{ name: 'mom', compare: { to: 'previousPeriod', measures: ['revenue'] } }],
      }, TENANT);
      expect(compilation.describe().plan).toBe('time');
      expect(compilation.sql).toContain('`_hq_calc_0_0_change_pct` AS `revenue_change_pct`');
      expect(compilation.parameters).toEqual(expect.arrayContaining(['2026-01-01']));
    });

    it('fills a series bucketed by other, with the top-N CTE in both statements', () => {
      const compilation = clockClient().compileDataset(Orders, {
        dimensions: ['country'], measures: ['revenue', 'users'], by: 'day', fill: true, filters: [january],
        other: { dimension: 'country', n: 2, measure: 'revenue' },
        // An additive share, and a non-additive one with a joined denominator.
        calculations: [{ name: 's', share: { measure: 'revenue', of: ['period'] } }, { name: 'u', share: { measure: 'users', of: ['period'] } }],
      }, TENANT);
      expect(compilation.sql).toContain('LEFT JOIN (SELECT `period`, `users` AS `_hq_total`');
      expect(compilation.describe().plan).toBe('time');
      expect(compilation.sql).toContain('_hq_series');
      for (const statement of [compilation, ...compilation.preflightStatements]) {
        expect(statement.sql).toMatch(/^WITH `_hq_other_top` AS /);
      }
    });

    it('counts filter-group comparisons, not groups, toward the predicate budget', () => {
      const group = { or: [...WEB, { field: 'country', operator: 'eq' as const, value: 'US' }] };
      const query = (where: typeof WEB) => ({
        measures: ['revenue'], filters: [group],
        calculations: [{ name: 'x', filter: { measure: 'revenue', where } }],
      }) as DatasetQuery;
      expect(errors(query(WEB))).toEqual([]);
      expect(errors(query([...WEB, ...WEB])).join('\n'))
        .toMatch(/Too many filters, having conditions and filter-calculation conditions: 4 \(max 3\)/);
      const sql = clockClient().toSQL(Orders, query(WEB), TENANT);
      expect(sql).toMatch(/\(orders\.channel = \? OR orders\.country = \?\)/);
    });

    it('plans a calculation on the selected time key', () => {
      const Shipped = dataset('shipped', {
        source: 'orders', tenantKey: 'tenant_id', timeKey: 'createdAt', timeKeys: ['shippedAt'],
        dimensions: {
          createdAt: dimension.timestamp({ column: 'created_at' }),
          shippedAt: dimension.timestamp({ column: 'shipped_at' }),
          amount: dimension.number(),
        },
        filters: { createdAt: { field: 'createdAt' }, shippedAt: { field: 'shippedAt' } },
        measures: { revenue: measure.sum('amount') },
      });
      const query = (field: string) => ({
        measures: ['revenue'], by: 'month' as const, timeKey: 'shippedAt',
        filters: [{ field, operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }],
        calculations: [{ name: 'p', shift: { measure: 'revenue', amount: 1, unit: 'month' as const } }],
      }) as DatasetQuery;
      // The bounded range must be on the axis the series runs on.
      expect(clockClient().validate(Shipped, query('createdAt'), TENANT).errors.join('\n')).toMatch(/bounded time range/);
      const compilation = clockClient().compileDataset(Shipped, query('shippedAt'), TENANT);
      expect(compilation.describe().timeKey).toBe('shippedAt');
      expect(compilation.sql).toContain('shipped_at');
      expect(compilation.sql).not.toContain('created_at');
    });
  });
});

