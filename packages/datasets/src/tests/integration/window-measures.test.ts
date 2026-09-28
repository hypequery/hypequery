import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { belongsTo } from '../../relationships.js';
import { subtract } from '../../formulas.js';
import { measure } from '../../measure.js';
import { buildWindowDatasetSql } from '../../utils/window-dataset-sql.js';
import { toQueryBuilderFactory } from '../../query-builder-protocol.js';
import { createDatasetClient } from '../../executor.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq78_window_execution';
const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('windowEvents', {
  source: table, timeKey: 'time', tenantKey: 'tenant',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }), group: dimension.string(), user: dimension.string(), value: dimension.number() },
  measures: {
    revenue: measure.sum('value'), users: measure.countDistinct('user'), count: measure.count('user'), average: measure.avg('value'), minimum: measure.min('value'), maximum: measure.max('value'),
    trailingUsers: measure.trailing('users', { amount: 3, unit: 'day' }),
    trailingRevenue: measure.trailing('revenue', { amount: 3, unit: 'day' }),
    trailingAverage: measure.trailing('average', { amount: 3, unit: 'day' }),
    monthRevenue: measure.toDate('revenue', 'month'),
    totalRevenue: measure.cumulative('revenue'), totalCount: measure.cumulative('count'), totalMinimum: measure.cumulative('minimum'), totalMaximum: measure.cumulative('maximum'),
    delta: measure.derived({ uses: { now: 'revenue', rolling: 'trailingRevenue' }, formula: ({ now, rolling }) => subtract(now, rolling) }),
  },
});
const context = { runtime: { tenant: { id: 'a' } } };
const range = [{ field: 'time', operator: 'gte' as const, value: '2026-01-02' }, { field: 'time', operator: 'lt' as const, value: '2026-01-06' }];

describe('window execution against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (event_at Nullable(DateTime64(9, 'UTC')), tenant String, group Nullable(String), user String, value Nullable(Float64)) ENGINE = MergeTree ORDER BY tuple()`);
    await insertRows(table, [
      { event_at: null, tenant: 'a', group: 'x', user: 'u1', value: 900 },
      { event_at: '2025-12-31 12:00:00', tenant: 'a', group: 'x', user: 'u1', value: 2 },
      { event_at: '2026-01-01 12:00:00', tenant: 'a', group: 'x', user: 'u1', value: 10 },
      { event_at: '2026-01-02 12:00:00', tenant: 'a', group: 'x', user: 'u1', value: 20 },
      { event_at: '2026-01-04 12:00:00', tenant: 'a', group: 'x', user: 'u2', value: 40 },
      { event_at: '2026-01-02 12:00:00', tenant: 'a', group: null, user: 'u3', value: 5 },
      { event_at: '2026-01-02 12:00:00', tenant: 'b', group: 'x', user: 'u9', value: 999 },
    ]);
    await runSql(`CREATE TABLE ${table}_timezones (event_at DateTime64(9, 'Europe/Madrid'), value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await insertRows(`${table}_timezones`, [
      { event_at: '2026-03-28 12:00:00', value: 10 },
      { event_at: '2026-03-29 12:00:00', value: 20 },
      { event_at: '2026-10-24 12:00:00', value: 30 },
      { event_at: '2026-10-25 12:00:00', value: 40 },
    ]);
    await runSql(`CREATE TABLE ${table}_dates (event_at Date, value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await insertRows(`${table}_dates`, [{ event_at: '2026-01-01', value: 10 }]);
    await runSql(`CREATE TABLE ${table}_users (user String, region String, tenant String) ENGINE = MergeTree ORDER BY user`);
    await insertRows(`${table}_users`, [{ user: 'u1', region: 'east', tenant: 'a' }, { user: 'u1', region: 'east', tenant: 'a' }, { user: 'u2', region: 'east', tenant: 'a' }, { user: 'u1', region: 'west', tenant: 'b' }]);

    await runSql(`CREATE TABLE ${table}_fold (event_at DateTime64(9, 'Europe/Madrid'), value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await runSql(`INSERT INTO ${table}_fold VALUES
      (parseDateTime64BestEffort('2026-10-25T02:15:00+02:00', 9, 'Europe/Madrid'), 10),
      (parseDateTime64BestEffort('2026-10-25T02:15:00+01:00', 9, 'Europe/Madrid'), 20)`);
    await runSql(`CREATE TABLE ${table}_fractional (event_at DateTime64(9, 'Asia/Kathmandu'), value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await insertRows(`${table}_fractional`, [
      { event_at: '2025-12-31 23:59:59', value: 5 },
      { event_at: '2026-01-01 00:00:00', value: 10 },
      { event_at: '2026-01-02 00:00:00', value: 20 },
    ]);
    await runSql(`CREATE TABLE ${table}_half_dst (event_at DateTime64(9, 'Australia/Lord_Howe'), value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await insertRows(`${table}_half_dst`, [
      { event_at: '2026-10-03 02:45:00', value: 10 },
      { event_at: '2026-10-04 02:45:00', value: 20 },
      { event_at: '2026-10-04 03:45:00', value: 30 },
    ]);
    await runSql(`CREATE TABLE ${table}_skipped_date (event_at DateTime64(9, 'Pacific/Apia'), value Float64) ENGINE = MergeTree ORDER BY event_at`);
    await insertRows(`${table}_skipped_date`, [
      { event_at: '2011-12-29 12:00:00', value: 10 },
      { event_at: '2011-12-31 12:00:00', value: 20 },
    ]);

  });
  afterAll(async () => {
    for (const suffix of ['', '_timezones', '_dates', '_users', '_fold', '_fractional', '_half_dst', '_skipped_date']) {
      await runSql(`DROP TABLE IF EXISTS ${table}${suffix}`);
    }
  });

  it('reaggregates distincts and averages, fills gaps, and looks before the range', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['trailingUsers', 'trailingRevenue', 'trailingAverage', 'revenue', 'count'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.trailingUsers, row.trailingRevenue, row.trailingAverage, row.revenue, row.count])).toEqual([
      ['1', '32', String(32 / 3), '20', '1'], ['1', '30', '15', null, '0'], ['2', '60', '30', '40', '1'], ['1', '40', '40', null, '0'],
    ]);
  });

  it('seeds cumulative history and resets month-to-date at calendar boundaries', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['monthRevenue', 'totalRevenue', 'totalCount', 'totalMinimum', 'totalMaximum'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.monthRevenue, row.totalRevenue, row.totalCount, row.totalMinimum, row.totalMaximum])).toEqual([
      ['30', '32', '3', '2', '20'], ['30', '32', '3', '2', '20'], ['70', '72', '4', '2', '40'], ['70', '72', '4', '2', '40'],
    ]);
  });

  it('partitions windows by nullable dimensions and evaluates formulas after windows', async () => {
    const result = await client.execute(Events, { by: 'day', dimensions: ['group'], measures: ['delta', 'totalRevenue'], filters: range }, context);
    expect(result.data).toHaveLength(8);
    expect(result.data.filter(row => row.group === null).map(row => row.totalRevenue)).toEqual(['5', '5', '5', '5']);
    expect(result.data.filter(row => row.group === 'x').map(row => row.delta)).toEqual(['-12', null, '-20', null]);
    expect(Object.keys(result.data[0]).sort()).toEqual(['delta', 'group', 'period', 'totalRevenue']);
  });

  it('fills an empty unpartitioned series with NULLs and zero counts', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['trailingRevenue', 'trailingUsers', 'totalCount'], filters: [...range, { field: 'user', operator: 'eq', value: 'missing' }] }, context);
    expect(result.data.map(row => [row.trailingRevenue, row.trailingUsers, row.totalCount])).toEqual(Array.from({ length: 4 }, () => [null, '0', '0']));
  });
  it('keeps segments and measure filters on lookback rows, including an empty filtered population', async () => {
    const ds = dataset('filteredWindows', {
      source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      segments: { groupX: { filters: [{ field: 'group', operator: 'eq', value: 'x' }] } },
      measures: {
        revenue: measure.sum('value', { filters: [{ field: 'user', operator: 'eq', value: 'u1' }] }),
        users: measure.countDistinct('user', { filters: [{ field: 'user', operator: 'eq', value: 'missing' }] }),
        average: measure.avg('value', { filters: [{ field: 'user', operator: 'eq', value: 'missing' }] }),
        rolling: measure.trailing('revenue', { amount: 3, unit: 'day' }), missing: measure.trailing('users', { amount: 3, unit: 'day' }), missingAverage: measure.trailing('average', { amount: 3, unit: 'day' }),
      },
    });
    const result = await client.execute(ds, { by: 'day', measures: ['rolling', 'missing', 'missingAverage'], filters: range, segments: ['groupX'] }, context);
    expect(result.data.map(row => [row.rolling, row.missing, row.missingAverage])).toEqual([['32', '0', null], ['30', '0', null], ['20', '0', null], ['0', '0', null]]);
  });

  it('supports all analytical aggregations by reaggregating the same source population', async () => {
    const ds = dataset('analyticalWindows', {
      source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      measures: {
        distinct: measure.approxCountDistinct('user'), percentile: measure.percentile('value', 0.5), variance: measure.variance('value'), deviation: measure.stddev('value'), latest: measure.argMax('value', 'time'), earliest: measure.argMin('value', 'time'), sql: measure.sum('value', { sql: 'value * 2' }),
        wDistinct: measure.trailing('distinct', { amount: 3, unit: 'day' }), wPercentile: measure.trailing('percentile', { amount: 3, unit: 'day' }), wVariance: measure.trailing('variance', { amount: 3, unit: 'day' }), wDeviation: measure.trailing('deviation', { amount: 3, unit: 'day' }), wLatest: measure.trailing('latest', { amount: 3, unit: 'day' }), wEarliest: measure.trailing('earliest', { amount: 3, unit: 'day' }), wSql: measure.trailing('sql', { amount: 3, unit: 'day' }),
      },
    });
    const result = await client.execute(ds, { by: 'day', measures: ['wDistinct', 'wPercentile', 'wVariance', 'wDeviation', 'wLatest', 'wEarliest', 'wSql'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data[2]).toMatchObject({ wDistinct: '2', wPercentile: '30', wVariance: '200', wLatest: '40', wEarliest: '20', wSql: '120' });
    expect(Number(result.data[2].wDeviation)).toBeCloseTo(Math.sqrt(200));
  });

  it('treats partial endpoint buckets differently for base and window measures', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['revenue', 'totalRevenue'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-02T13:00:00Z', '2026-01-04T10:00:00Z'] }, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => [row.revenue, row.totalRevenue])).toEqual([[null, '32'], [null, '32'], [null, '72']]);
  });

  it('retains sub-millisecond upper boundaries and excludes exact bucket ends', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['totalRevenue'], filters: [{ field: 'time', operator: 'gte', value: '2026-01-02' }, { field: 'time', operator: 'lt', value: '2026-01-03T00:00:00.000000001Z' }, { field: 'group', operator: 'eq', value: 'x' }] }, context);
    expect(result.data.map(row => row.totalRevenue)).toEqual(['32', '32']);
  });

  it('enforces the exact series limit and paginates only after window evaluation', async () => {
    await expect(client.execute(Events, { by: 'day', measures: ['totalRevenue'], filters: range, limit: 3 }, context)).rejects.toThrow('Window series exceeds the effective result limit of 3 buckets.');
    const result = await client.execute(Events, { by: 'day', dimensions: ['group'], measures: ['totalRevenue'], filters: range, limit: 4, offset: 1 }, context);
    expect(result.data).toHaveLength(4);
    expect(result.meta.pagination.hasMore).toBe(true);
    const ordered = await client.execute(Events, { by: 'day', measures: ['totalRevenue'], filters: [...range, { field: 'group', operator: 'eq', value: 'x' }], orderBy: [{ field: 'totalRevenue', direction: 'desc' }] }, context);
    expect(ordered.data.map(row => row.totalRevenue)).toEqual(['72', '72', '32', '32']);
  });

  it('supports Date columns at calendar grains and resets at month boundaries', async () => {
    const ds = dataset('datedWindows', { source: `${table}_dates`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), monthly: measure.toDate('revenue', 'month') } });
    const result = await client.execute(ds, { by: 'day', measures: ['monthly'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-31', '2026-02-01'] }] });
    expect(result.data.map(row => row.monthly)).toEqual(['10', null]);
  });

  it.each([
    ['2026-03-29', '2026-03-30', 23, '20'],
    ['2026-10-25', '2026-10-26', 25, '40'],
  ])('preserves the physical timezone across DST from %s to %s', async (lower, upper, buckets, last) => {
    const ds = dataset('timezoneWindows', { source: `${table}_timezones`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), daily: measure.trailing('revenue', { amount: 1, unit: 'day' }), running: measure.cumulative('revenue') } });
    const result = await client.execute(ds, { by: 'hour', measures: ['daily'], filters: [{ field: 'time', operator: 'gte', value: lower }, { field: 'time', operator: 'lt', value: upper }] });
    expect(result.data).toHaveLength(buckets);
    expect(result.data.at(-1)?.daily).toBe(last);
  });

  it('uses LEFT ANY relationship joins and target tenant scope for all windows', async () => {
    const Users = dataset('windowUsers', { source: `${table}_users`, tenantKey: 'tenant', dimensions: { user: dimension.string(), region: dimension.string() } });
    const ds = dataset('relatedWindows', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions, measures: { revenue: measure.sum('value'), rolling: measure.trailing('revenue', { amount: 3, unit: 'day' }) }, relationships: { customer: belongsTo(() => Users, { from: 'user', to: 'user' }) } });
    const result = await client.execute(ds, { by: 'day', dimensions: ['customer.region'], measures: ['rolling'], filters: [...range, { field: 'customer.region', operator: 'eq', value: 'east' }] }, context);
    expect(result.data.map(row => [row['customer.region'], row.rolling])).toEqual([['east', '32'], ['east', '30'], ['east', '60'], ['east', '40']]);
  });

  it('keeps the two offset-qualified autumn hours distinct despite identical local labels', async () => {
    const ds = dataset('foldWindows', {
      source: `${table}_fold`, timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
      measures: { revenue: measure.sum('value'), running: measure.cumulative('revenue') },
    });
    const result = await client.execute(ds, {
      by: 'hour', measures: ['revenue', 'running'], limit: 2,
      filters: [
        { field: 'time', operator: 'gte', value: '2026-10-25T02:00:00+02:00' },
        { field: 'time', operator: 'lt', value: '2026-10-25T03:00:00+01:00' },
      ],
    });
    expect(result.data.map(row => [row.revenue, row.running])).toEqual([['10', '10'], ['20', '30']]);
    // ClickHouse JSON renders local labels without offsets; the buckets remain separate rows.
    expect(result.data[0].period).toBe(result.data[1].period);
  });

  it('uses fractional-offset local midnight and equivalent UTC bounds at the exact limit', async () => {
    const ds = dataset('fractionalWindows', {
      source: `${table}_fractional`, timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
      measures: { revenue: measure.sum('value'), running: measure.cumulative('revenue') },
    });
    const execute = (lower: string, upper: string) => client.execute(ds, {
      by: 'day', measures: ['revenue', 'running'], limit: 2,
      filters: [
        { field: 'time', operator: 'gte', value: lower },
        { field: 'time', operator: 'lt', value: upper },
      ],
    });
    const local = await execute('2026-01-01', '2026-01-03');
    const utc = await execute('2025-12-31T18:15:00Z', '2026-01-02T18:15:00Z');
    expect(local.data.map(row => [row.revenue, row.running])).toEqual([['10', '15'], ['20', '35']]);
    expect(utc.data).toEqual(local.data);
  });

  it('preserves window populations across a thirty-minute DST jump', async () => {
    const ds = dataset('halfHourDstWindows', {
      source: `${table}_half_dst`, timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
      measures: {
        revenue: measure.sum('value'), running: measure.cumulative('revenue'),
        daily: measure.trailing('revenue', { amount: 1, unit: 'day' }),
      },
    });
    const result = await client.execute(ds, {
      by: 'hour', measures: ['daily', 'running'], limit: 5,
      filters: [
        { field: 'time', operator: 'gte', value: '2026-10-04T00:00:00' },
        { field: 'time', operator: 'lt', value: '2026-10-04T05:00:00' },
      ],
    });
    expect(result.data.map(row => [row.daily, row.running]))
      .toEqual([['10', '10'], ['10', '10'], ['20', '30'], ['50', '60'], ['50', '60']]);
  });

  it('rejects a skipped calendar date in the output axis or trailing lookback', async () => {
    const ds = dataset('skippedDateWindows', {
      source: `${table}_skipped_date`, timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
      measures: {
        revenue: measure.sum('value'), running: measure.cumulative('revenue'),
        rolling: measure.trailing('revenue', { amount: 3, unit: 'day' }),
      },
    });
    const axisQuery = {
      by: 'day' as const, measures: ['running'],
      filters: [{ field: 'time', operator: 'between' as const, value: ['2011-12-29', '2011-12-31'] }],
    };
    const precedingDay = await client.execute(ds, {
      by: 'day', measures: ['running'],
      filters: [{ field: 'time', operator: 'between', value: ['2011-12-28', '2011-12-28'] }],
    });
    expect(precedingDay.data.map(row => row.running)).toEqual([null]);
    await expect(client.execute(ds, {
      by: 'day', measures: ['running'],
      filters: [{ field: 'time', operator: 'between', value: ['2011-12-29', '2011-12-29'] }],
    })).rejects.toThrow(/skipped local calendar bucket/);
    await expect(client.execute(ds, axisQuery)).rejects.toThrow(/skipped local calendar bucket/);
    const { sql, parameters } = buildWindowDatasetSql(ds, axisQuery, { builderFactory: toQueryBuilderFactory(db) });
    await expect(db.rawQuery(sql, parameters)).rejects.toThrow(/skipped local calendar bucket/);
    await expect(client.execute(ds, {
      by: 'day', measures: ['rolling'],
      filters: [{ field: 'time', operator: 'between', value: ['2011-12-31', '2012-01-01'] }],
    })).rejects.toThrow(/skipped local calendar bucket/);
  });

  it('resolves mixed local and offset bounds using the physical column timezone', async () => {
    const ds = dataset('mixedBounds', { source: `${table}_timezones`, timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() }, measures: { revenue: measure.sum('value'), daily: measure.trailing('revenue', { amount: 1, unit: 'day' }) } });
    const result = await client.execute(ds, { by: 'hour', measures: ['daily'], filters: [{ field: 'time', operator: 'gte', value: '2026-03-29' }, { field: 'time', operator: 'lt', value: '2026-03-28T23:30:00Z' }] });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].daily).toBe('10');
    await expect(client.execute(ds, { by: 'hour', measures: ['daily'], filters: [{ field: 'time', operator: 'gte', value: '2026-03-29' }, { field: 'time', operator: 'lt', value: '2026-03-28T22:30:00Z' }] })).rejects.toThrow('Window measure time range must be non-empty and ordered.');
  });

  it('fills dimension combinations found only in cumulative lookback history', async () => {
    const result = await client.execute(Events, { by: 'day', dimensions: ['group'], measures: ['totalRevenue', 'revenue'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-05', '2026-01-06'] }, { field: 'user', operator: 'eq', value: 'u3' }] }, context);
    expect(result.data.map(row => [row.group, row.totalRevenue, row.revenue])).toEqual([[null, '5', null], [null, '5', null]]);
  });

  it('rejects an oversized series even when no dimension combination matches', async () => {
    const query = { by: 'day' as const, dimensions: ['group'], measures: ['totalRevenue'], filters: [...range, { field: 'user', operator: 'eq' as const, value: 'missing' }], limit: 3 };
    await expect(client.execute(Events, query, context)).rejects.toThrow('Window series exceeds the effective result limit of 3 buckets.');
    const { sql, parameters } = buildWindowDatasetSql(Events, query, { builderFactory: toQueryBuilderFactory(db), context });
    await expect(db.rawQuery(sql, parameters)).rejects.toThrow('Window series exceeds the effective result limit of 3 buckets.');
  });

  it('converts calendar intervals without replacing months by days', async () => {
    const ds = dataset('calendarWindows', { source: table, timeKey: 'time', tenantKey: 'tenant', dimensions: Events.dimensions,
      measures: { revenue: measure.sum('value'), quarter: measure.trailing('revenue', { amount: 1, unit: 'quarter' }), year: measure.trailing('revenue', { amount: 1, unit: 'year' }), week: measure.trailing('revenue', { amount: 1, unit: 'week' }) },
    });
    const months = await client.execute(ds, { by: 'month', measures: ['quarter'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-01', '2026-03-31'] }] }, context);
    expect(months.data.map(row => row.quarter)).toEqual(['77', '77', '75']);
    const years = await client.execute(ds, { by: 'year', measures: ['year'], filters: [{ field: 'time', operator: 'between', value: ['2026-01-01', '2027-12-31'] }] }, context);
    expect(years.data.map(row => row.year)).toEqual(['75', null]);
    const weeks = await client.execute(ds, { by: 'week', measures: ['week'], filters: range }, context);
    expect(weeks.data.map(row => row.week)).toEqual(['37', '40']);
  });

});
