import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, add } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq_query_timezone';
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });
const TokyoSource = dataset('timezoneEvents', {
  source: table, timeKey: 'time',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
  filters: { range: { field: 'time' } },
  measures: {
    revenue: measure.sum('value'), running: measure.cumulative('revenue'),
    doubled: measure.derived({ uses: { value: 'revenue' }, formula: ({ value }) => add(value, value) }),
  },
});
const filters = [
  { field: 'range', operator: 'gte' as const, value: '2026-01-02' },
  { field: 'range', operator: 'lt' as const, value: '2026-01-03' },
];

describe('query timezone against ClickHouse', () => {
  beforeAll(async () => {
    // The physical timezone differs from the API default and query overrides.
    await runSql(`CREATE TABLE ${table} (event_at DateTime64(9, 'Asia/Tokyo'), value Float64) ENGINE=Memory`);
    await runSql(`INSERT INTO ${table} VALUES
      (parseDateTime64BestEffort('2026-01-01T23:30:00Z', 9), 10),
      (parseDateTime64BestEffort('2026-01-02T00:30:00Z', 9), 20),
      (parseDateTime64BestEffort('2026-01-02T23:30:00Z', 9), 30),
      (parseDateTime64BestEffort('2026-01-03T00:30:00Z', 9), 40)`);
    await runSql(`CREATE TABLE ${table}_dates (event_at Date32, value Float64) ENGINE=Memory`);
    await insertRows(`${table}_dates`, [{ event_at: '2026-01-02', value: 10 }]);
  });
  afterAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql(`DROP TABLE IF EXISTS ${table}_dates`);
  });

  it.each([
    ['UTC', '50', '60'], ['Asia/Tokyo', '30', '30'], ['America/New_York', '70', '100'],
  ])('keeps base, window, derived, and metric populations consistent in %s', async (timezone, revenue, running) => {
    const base = await client.execute(TokyoSource, { by: 'day', measures: ['revenue'], filters, timezone });
    const windows = await client.execute(TokyoSource, { by: 'day', measures: ['revenue', 'running'], filters, timezone });
    const derived = await client.execute(TokyoSource, { by: 'day', measures: ['revenue', 'doubled'], filters, timezone });
    const metric = TokyoSource.metric('metricRevenue', { measure: 'revenue' }).by('day');
    const metricResult = await client.execute(metric, { filters, timezone });
    const doubledMetric = TokyoSource.metric('doubledMetric', {
      uses: { value: TokyoSource.metric('base', { measure: 'revenue' }) },
      formula: ({ value }) => add(value, value),
    });
    const derivedMetric = await client.execute(doubledMetric, { by: 'day', filters, timezone });
    expect(base.data).toEqual([{ period: '2026-01-02 00:00:00', revenue }]);
    expect(windows.data.map(row => [row.revenue, row.running])).toEqual([[revenue, running]]);
    expect(derived.data[0].doubled).toBe(String(Number(revenue) * 2));
    expect(metricResult.data[0].metricRevenue).toBe(revenue);
    expect(derivedMetric.data[0].doubledMetric).toBe(String(Number(revenue) * 2));
  });

  it('defaults to UTC, applies the client default, and partitions cached overrides', async () => {
    const query = { by: 'day' as const, measures: ['revenue', 'running'], filters };
    const utc = await client.execute(TokyoSource, query);
    expect(utc.data[0].revenue).toBe('50');
    const tokyo = createDatasetClient({ queryBuilder: db, timezone: 'Asia/Tokyo', cache: { ttlMs: 60000 } });
    expect((await tokyo.execute(TokyoSource, query)).data[0].revenue).toBe('30');
    expect((await tokyo.execute(TokyoSource, { ...query, timezone: 'UTC' })).data).toEqual(utc.data);
    const hit = await tokyo.execute(TokyoSource, { ...query, timezone: 'Asia/Tokyo' });
    expect(hit.data[0].revenue).toBe('30');
    expect(hit.meta.cache?.hit).toBe(true);
  });

  it.each([['UTC', '50'], ['Asia/Tokyo', '30'], ['America/New_York', '70']])(
    'uses the requested %s timezone for shifted source buckets', async (timezone, prior) => {
      const Comparisons = dataset('timezoneComparisons', {
        source: table, timeKey: 'time', dimensions: TokyoSource.dimensions,
        measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', { amount: 1, unit: 'day' }) },
      });
      const result = await client.execute(Comparisons, {
        by: 'day', timezone, measures: ['prior'],
        filters: [
          { field: 'time', operator: 'gte', value: '2026-01-03' },
          { field: 'time', operator: 'lt', value: '2026-01-04' },
        ],
      });
      expect(result.data.map(row => row.prior)).toEqual([prior]);
    },
  );

  it('treats offset bounds as instants in both base and window queries', async () => {
    const instantFilters = [
      { field: 'range', operator: 'gte' as const, value: '2026-01-02T00:00:00Z' },
      { field: 'range', operator: 'lt' as const, value: '2026-01-03T00:00:00Z' },
    ];
    for (const measures of [['revenue'], ['revenue', 'running']]) {
      const result = await client.execute(TokyoSource, { by: 'day', measures, filters: instantFilters, timezone: 'America/New_York' });
      expect(result.data.map(row => row.revenue)).toEqual(['20', '30']);
    }
  });

  it.each(['UTC', 'America/New_York', 'Asia/Kathmandu'])('preserves Date32 calendar dates in %s', async timezone => {
    const Dates = dataset('dateEvents', { source: `${table}_dates`, timeKey: 'time', dimensions: TokyoSource.dimensions, measures: TokyoSource.measures, filters: { range: { field: 'time' } } });
    const result = await client.execute(Dates, { by: 'day', measures: ['revenue', 'running'], filters, timezone });
    expect(result.data.map(row => [row.revenue, row.running])).toEqual([['10', '10']]);
  });
});
