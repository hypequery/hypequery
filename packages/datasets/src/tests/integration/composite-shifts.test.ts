import { getDatasetCatalog } from '../../catalog.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, divide, nullIfZero, subtract } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq_composite_shifts';
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('compositeShiftEvents', {
  source: table, timeKey: 'time', dimensions: { time: dimension.timestamp(), group: dimension.string() },
  measures: {
    revenue: measure.sum('value'), orders: measure.count('value'), average: measure.avg('value'), users: measure.countDistinct('user'),
    ytd: measure.toDate('revenue', 'year'), priorYtd: measure.shift('ytd', { amount: 1, unit: 'year' }),
    rollingAverage: measure.trailing('average', { amount: 2, unit: 'month' }),
    priorAverage: measure.shift('rollingAverage', { amount: 1, unit: 'year' }),
    rollingUsers: measure.trailing('users', { amount: 2, unit: 'month' }),
    priorUsers: measure.shift('rollingUsers', { amount: 1, unit: 'year' }),
    total: measure.cumulative('revenue'), priorTotal: measure.shift('total', { amount: 1, unit: 'year' }),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
    priorAov: measure.shift('aov', { amount: 1, unit: 'year' }),
    growth: measure.derived({ uses: { current: 'aov', prior: 'priorAov' }, formula: ({ current, prior }) => subtract(divide(current, nullIfZero(prior)), 1) }),
    twice: measure.shift('priorAov', { amount: 1, unit: 'year' }),
  },
});
const filters = [{ field: 'time', operator: 'gte' as const, value: '2024-02-01' }, { field: 'time', operator: 'lt' as const, value: '2024-03-01' }];

describe('shifted windows and formulas', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (time DateTime64(9, 'UTC'), group Nullable(String), value Float64, user String) ENGINE=Memory`);
    await insertRows(table, [
      { time: '2022-02-10', group: null, value: 8, user: 'a' },
      { time: '2022-12-10', group: null, value: 100, user: 'a' },
      { time: '2023-01-10', group: null, value: 10, user: 'a' },
      { time: '2023-02-10', group: null, value: 20, user: 'a' },
      { time: '2023-02-15', group: null, value: 30, user: 'b' },
      { time: '2023-04-10', group: 'unscanned', value: 999, user: 'c' },
      { time: '2024-01-10', group: null, value: 50, user: 'a' },
      { time: '2024-02-10', group: null, value: 100, user: 'a' },
      { time: '2024-02-15', group: null, value: 200, user: 'b' },
    ]);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${table}`); });

  it('recalculates YTD in the prior year, rather than shifting current YTD values', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['ytd', 'priorYtd'], filters });
    expect(result.data.map(row => [row.ytd, row.priorYtd])).toEqual([['350', '60']]);
  });
  it('reaggregates source rows for shifted distinct counts and averages', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['priorAverage', 'priorUsers'], filters });
    expect(result.data.map(row => [row.priorAverage, row.priorUsers])).toEqual([['20', '2']]);
  });
  it('evaluates ratios and nested growth after aggregation', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['aov', 'priorAov', 'growth', 'twice'], filters });
    expect(result.data.map(row => [row.aov, row.priorAov, row.growth, row.twice])).toEqual([['150', '25', '5', '8']]);
  });
  it('looks up cumulative values before each shifted bucket end, with nullable partitions', async () => {
    const result = await client.execute(Events, { by: 'month', dimensions: ['group'], measures: ['priorTotal'], filters });
    expect(result.data.map(row => [row.group, row.priorTotal])).toEqual([[null, '168']]);
  });
  it('keeps window buckets whole while base formula inputs respect partial bounds', async () => {
    const result = await client.execute(Events, { by: 'month', measures: ['priorYtd', 'priorAov'], filters: [
      { field: 'time', operator: 'gte', value: '2024-02-11' }, { field: 'time', operator: 'lt', value: '2024-02-20' },
    ] });
    expect(result.data.map(row => [row.priorYtd, row.priorAov])).toEqual([['60', '30']]);
  });
  it('intersects wrapper and dependency grain requirements in catalogs', () => {
    const catalog = getDatasetCatalog(Events);
    expect(catalog.measures.priorYtd.supportedGrains).toEqual(['day', 'month', 'quarter']);
    expect(catalog.measures.priorAverage.supportedGrains).toEqual(['month']);
    expect(catalog.measures.priorAov.aggregation).toBeUndefined();
    expect(catalog.derivedMeasures?.growth.requiresTimeRange).toBe(true);
  });
  it('rejects mixed shift/formula cycles', () => {
    expect(() => dataset('cycle', { source: table, timeKey: 'time', dimensions: Events.dimensions, measures: {
      current: measure.derived({ uses: { value: 'prior' }, formula: ({ value }) => divide(value, 2) }),
      prior: measure.shift('current', { amount: 1, unit: 'year' }),
    } })).toThrow(/dependency cycle/);
  });

  it('rejects a shifted formula whose local hour did not exist in the earlier year', async () => {
    await expect(client.execute(Events, { by: 'hour', timezone: 'Europe/Madrid', measures: ['priorAov'], filters: [
      { field: 'time', operator: 'gte', value: '2025-03-31T01:00:00' },
      { field: 'time', operator: 'lt', value: '2025-03-31T04:00:00' },
    ] })).rejects.toThrow(/nonexistent local time/);
  });
});
