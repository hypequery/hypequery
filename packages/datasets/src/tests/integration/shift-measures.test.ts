import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { belongsTo } from '../../relationships.js';
import { buildTimeMeasureDatasetSql } from '../../utils/time-measure-dataset-sql.js';
import { toQueryBuilderFactory } from '../../query-builder-protocol.js';
import { subtractTimeSql } from '../../utils/time-arithmetic-sql.js';
import { divide, nullIfZero, subtract } from '../../formulas.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq79_shift_execution';
const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('shiftEvents', {
  source: table, timeKey: 'time', tenantKey: 'tenant',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }), group: dimension.string(), user: dimension.string(), value: dimension.number() },
  measures: {
    revenue: measure.sum('value'), count: measure.count('user'), distinct: measure.countDistinct('user'), average: measure.avg('value'),
    priorRevenue: measure.shift('revenue', { amount: 1, unit: 'year' }),
    priorCount: measure.shift('count', { amount: 1, unit: 'year' }),
    priorDistinct: measure.shift('distinct', { amount: 1, unit: 'year' }),
    priorAverage: measure.shift('average', { amount: 1, unit: 'year' }),
    rollingRevenue: measure.trailing('revenue', { amount: 2, unit: 'month' }),
    growth: measure.derived({ uses: { now: 'revenue', prior: 'priorRevenue' }, formula: ({ now, prior }) => divide(subtract(now, prior), nullIfZero(prior)) }),
    rollingDelta: measure.derived({ uses: { rolling: 'rollingRevenue', prior: 'priorRevenue' }, formula: ({ rolling, prior }) => subtract(rolling, prior) }),
  },
});
const context = { runtime: { tenant: { id: 'a' } } };
const range = [{ field: 'time', operator: 'gte' as const, value: '2026-01-01' }, { field: 'time', operator: 'lt' as const, value: '2026-04-01' }];

describe('shift execution against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (event_at Nullable(DateTime64(9, 'UTC')), tenant String, group Nullable(String), user String, value Nullable(Float64)) ENGINE=MergeTree ORDER BY tuple()`);
    await insertRows(table, [
      { event_at: null, tenant: 'a', group: 'x', user: 'null', value: 999 },
      { event_at: '2025-01-01 00:00:00', tenant: 'a', group: 'x', user: 'u1', value: 10 },
      { event_at: '2025-01-31 23:59:59.999999999', tenant: 'a', group: 'x', user: 'u1', value: 20 },
      { event_at: '2025-02-01 00:00:00', tenant: 'a', group: 'x', user: 'u2', value: 40 },
      { event_at: '2025-01-15 00:00:00', tenant: 'a', group: null, user: 'u3', value: 5 },
      { event_at: '2025-01-15 00:00:00', tenant: 'b', group: 'x', user: 'u9', value: 999 },
      { event_at: '2025-06-01 00:00:00', tenant: 'a', group: 'intervening', user: 'u4', value: 100 },
      { event_at: '2026-01-05 00:00:00', tenant: 'a', group: 'x', user: 'u1', value: 60 },
      { event_at: '2026-03-05 00:00:00', tenant: 'a', group: 'x', user: 'u2', value: 90 },
    ]);
    await runSql(`CREATE TABLE ${table}_timezones (event_at DateTime64(9, 'Europe/Madrid'), value Float64) ENGINE=MergeTree ORDER BY event_at`);
    await insertRows(`${table}_timezones`, [{ event_at: '2026-03-31 23:30:00', value: 30 }, { event_at: '2026-04-01 00:30:00', value: 60 }]);
    await insertRows(`${table}_timezones`, ['2026-03-28', '2026-10-24'].flatMap(day => Array.from({ length: 5 }, (_, hour) => ({ event_at: `${day} 0${hour}:30:00`, value: hour + 1 }))));
    await runSql(`CREATE TABLE ${table}_calendar (event_at Date, value Float64) ENGINE=MergeTree ORDER BY event_at`);
    await insertRows(`${table}_calendar`, [{ event_at: '2024-02-28', value: 10 }, { event_at: '2024-02-29', value: 20 }, { event_at: '2024-03-31', value: 40 }, { event_at: '2024-04-01', value: 80 }]);
    await runSql(`CREATE TABLE ${table}_users (user String, region String, tenant String) ENGINE=MergeTree ORDER BY user`);
    await insertRows(`${table}_users`, [{ user: 'u1', region: 'east', tenant: 'a' }, { user: 'u1', region: 'east', tenant: 'a' }, { user: 'u2', region: 'east', tenant: 'a' }, { user: 'u1', region: 'west', tenant: 'b' }]);

  });
  afterAll(async () => { for (const name of [table, `${table}_timezones`, `${table}_calendar`, `${table}_users`]) await runSql(`DROP TABLE IF EXISTS ${name}`); });

  it('compares sparse buckets with exact source aggregation and filled counts', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['revenue', 'priorRevenue', 'priorCount', 'priorDistinct', 'priorAverage', 'growth'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.revenue, row.priorRevenue, row.priorCount, row.priorDistinct, row.priorAverage, row.growth])).toEqual([
      ['60', '30', '2', '1', '15', '1'], [null, '40', '1', '1', '40', null], ['90', null, '0', '0', null, null],
    ]);
  });

  it('keeps nullable partitions but excludes dimensions in unscanned intervening months', async () => {
    const result = await client.execute(Events, { by: 'month', dimensions: ['group'], measures: ['revenue', 'priorRevenue'], filters: range }, context);
    expect(result.data).toHaveLength(6);
    expect(result.data.filter(row => row.group === null).map(row => row.priorRevenue)).toEqual(['5', null, null]);
    expect(result.data.some(row => row.group === 'intervening')).toBe(false);
  });

  it('evaluates shifted measures and rolling measures in one formula', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['rollingDelta'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => row.rollingDelta)).toEqual(['30', '20', null]);
    expect(Object.keys(result.data[0]).sort()).toEqual(['period', 'rollingDelta']);
  });

  it('fills an empty comparison series without inventing a prior value', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['priorRevenue', 'priorCount'], filters: [...range, { field: 'user', operator: 'eq', value: 'missing' }] }, context);
    expect(result.data.map(row => [row.priorRevenue, row.priorCount])).toEqual([[null, '0'], [null, '0'], [null, '0']]);
  });
  it('retains segments and measure-local filters throughout the comparison range', async () => {
    const ds = dataset('filteredComparisons', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      segments: { groupX: { filters: [{ field: 'group', operator: 'eq', value: 'x' }] } },
      measures: { revenue: measure.sum('value', { filters: [{ field: 'user', operator: 'eq', value: 'u1' }] }), prior: measure.shift('revenue', { amount: 1, unit: 'year' }) },
    });
    const result = await client.execute(ds, { by: 'month', measures: ['prior'], filters: range, segments: ['groupX'] }, context);
    expect(result.data.map(row => row.prior)).toEqual(['30', '0', null]);
  });

  it('uses full shifted buckets even when the output range selects partial buckets', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['revenue', 'priorRevenue'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-15', '2026-02-15'] }, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.revenue, row.priorRevenue])).toEqual([[null, '30'], [null, '40']]);
  });

  it('orders and paginates after comparisons and rejects an oversized empty series', async () => {
    const result = await client.execute(Events, { by: 'month', dimensions: ['group'], measures: ['priorRevenue'], filters: range, limit: 3, offset: 1, orderBy: [{ field: 'priorRevenue', direction: 'desc' }] }, context);
    expect(result.data.map(row => row.priorRevenue)).toEqual(['30', '5', null]);
    expect(result.meta.pagination.hasMore).toBe(true);
    const query = { by: 'month' as const, dimensions: ['group'], measures: ['priorRevenue'], filters: [...range, { field: 'user', operator: 'eq' as const, value: 'missing' }], limit: 2 };
    await expect(client.execute(Events, query, context)).rejects.toThrow(/effective result limit/);
    const { sql, parameters } = buildTimeMeasureDatasetSql(Events, query, { builderFactory: toQueryBuilderFactory(db), context });
    await expect(db.rawQuery(sql, parameters)).rejects.toThrow(/effective result limit/);
  });

  it.each([
    ['2026-03-29', ['1', '5', '4', '5']],
    ['2026-10-25', ['1', '2', null, '3', '4', '5']],
  ])('preserves exact shifted endpoints over DST on %s', async (day, expected) => {
    const ds = dataset('dstComparisons', { source: `${table}_timezones`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), priorDay: measure.shift('revenue', { amount: 1, unit: 'day' }) } });
    const result = await client.execute(ds, { by: 'hour', measures: ['priorDay'], filters: [{ field: 'time', operator: 'gte', value: `${day}T00:00:00` }, { field: 'time', operator: 'lt', value: `${day}T05:00:00` }] });
    expect(result.data.map(row => row.priorDay)).toEqual(expected);
  });

  it('compares leap-month Date buckets using calendar subtraction', async () => {
    const ds = dataset('calendarComparisons', { source: `${table}_calendar`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }) } });
    const result = await client.execute(ds, { by: 'month', measures: ['priorMonth'], filters: [{ field: 'time', operator: 'between', value: ['2024-03-01', '2024-05-31'] }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['30', '40', '80']);
    // The shared SQL arithmetic uses ClickHouse's clamping for month ends.
    const clamped = await db.rawQuery<{ prior: string }>(`SELECT ${subtractTimeSql("toDate('2024-03-31')", 1, 'month')} AS prior`);
    expect(clamped[0].prior).toBe('2024-02-29');
  });

  it('preserves LEFT ANY joins and target tenancy on comparison rows', async () => {
    const Users = dataset('comparisonUsers', { source: `${table}_users`, tenantKey: 'tenant', dimensions: { user: dimension.string(), region: dimension.string() } });
    const ds = dataset('relatedComparisons', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions, measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }) }, relationships: { customer: belongsTo(() => Users, { from: 'user', to: 'user' }) } });
    const result = await client.execute(ds, { by: 'month', dimensions: ['customer.region'], measures: ['prior'], filters: [...range, { field: 'customer.region', operator: 'eq', value: 'east' }] }, context);
    expect(result.data.map(row => [row['customer.region'], row.prior])).toEqual([['east', '30'], ['east', '40'], ['east', null]]);
  });

  it('supports analytical aggregates and SQL-backed expressions over prior rows', async () => {
    const ds = dataset('analyticalComparisons', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      measures: { latest: measure.argMax('value', 'time'), earliest: measure.argMin('value', 'time'), median: measure.median('value'), variance: measure.variance('value'), deviation: measure.stddev('value'), approx: measure.approxCountDistinct('user'), doubled: measure.sum('value', { sql: 'value * 2' }),
        priorLatest: measure.shift('latest', { amount: 1, unit: 'year' }), priorEarliest: measure.shift('earliest', { amount: 1, unit: 'year' }), priorMedian: measure.shift('median', { amount: 1, unit: 'year' }), priorVariance: measure.shift('variance', { amount: 1, unit: 'year' }), priorDeviation: measure.shift('deviation', { amount: 1, unit: 'year' }), priorApprox: measure.shift('approx', { amount: 1, unit: 'year' }), priorDoubled: measure.shift('doubled', { amount: 1, unit: 'year' }) },
    });
    const result = await client.execute(ds, { by: 'month', measures: ['priorLatest', 'priorEarliest', 'priorMedian', 'priorVariance', 'priorDeviation', 'priorApprox', 'priorDoubled'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data[0]).toMatchObject({ priorLatest: '20', priorEarliest: '10', priorMedian: '15', priorVariance: '50', priorApprox: '1', priorDoubled: '60' });
    expect(Number(result.data[0].priorDeviation)).toBeCloseTo(Math.sqrt(50));
  });

  it('does not duplicate rows when cumulative history overlaps shifted populations', async () => {
    const ds = dataset('cumulativeComparisons', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }), running: measure.cumulative('revenue'), delta: measure.derived({ uses: { running: 'running', prior: 'prior' }, formula: ({ running, prior }) => subtract(running, prior) }) },
    });
    const result = await client.execute(ds, { by: 'month', measures: ['running', 'prior', 'delta'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.running, row.prior, row.delta])).toEqual([['130', '30', '100'], ['130', '40', '90'], ['220', null, null]]);
  });

  it('keeps non-UTC calendar bucket boundaries in the physical column timezone', async () => {
    const ds = dataset('localCalendarComparisons', { source: `${table}_timezones`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }) } });
    const result = await client.execute(ds, { by: 'month', measures: ['priorMonth'], filters: [{ field: 'time', operator: 'gte', value: '2026-04-01' }, { field: 'time', operator: 'lt', value: '2026-06-01' }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['45', '60']);
  });

  it('rejects sub-day grains on a physical Date column using metadata only', async () => {
    const ds = dataset('dateTimeOfDay', { source: `${table}_calendar`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), priorDay: measure.shift('revenue', { amount: 1, unit: 'day' }) } });
    await expect(client.execute(ds, { by: 'hour', measures: ['priorDay'], filters: [{ field: 'time', operator: 'between', value: ['2024-03-01', '2024-03-02'] }] })).rejects.toThrow(/time-of-day column/);
  });

});
