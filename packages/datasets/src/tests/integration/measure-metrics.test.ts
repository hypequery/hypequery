import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, divide, nullIfZero, subtract } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq_measure_metrics';
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('measureMetricEvents', {
  source: table, timeKey: 'time', tenantKey: 'tenant',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }), group: dimension.string(), tenant: dimension.string() },
  measures: {
    revenue: measure.sum('value'), orders: measure.count('value'), ytd: measure.toDate('revenue', 'year'),
    priorYtd: measure.shift('ytd', { amount: 1, unit: 'year' }), priorRevenue: measure.shift('revenue', { amount: 1, unit: 'year' }),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
    priorAov: measure.shift('aov', { amount: 1, unit: 'year' }),
    growth: measure.derived({ uses: { current: 'aov', prior: 'priorAov' }, formula: ({ current, prior }) => subtract(divide(current, nullIfZero(prior)), 1) }),
  },
});
const PriorYtd = Events.metric('previousYearToDate', { measure: 'priorYtd' });
const Growth = Events.metric('aovGrowth', { measure: 'growth' });
const Average = Events.metric('averageOrderValue', { measure: 'aov' });
const PriorAverage = Events.metric('previousAverage', { measure: 'priorAov' });
const PriorRevenue = Events.metric('previousRevenue', { measure: 'priorRevenue' });
const range = [{ field: 'time', operator: 'gte' as const, value: '2024-02-01' }, { field: 'time', operator: 'lt' as const, value: '2024-03-01' }];
const context = { runtime: { tenant: { id: 'a' } } };

describe('metrics backed by dataset measures', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (event_at DateTime64(9, 'UTC'), group Nullable(String), tenant String, value Float64) ENGINE=Memory`);
    await insertRows(table, [
      { event_at: '2023-01-10', group: null, tenant: 'a', value: 10 },
      { event_at: '2023-02-10', group: null, tenant: 'a', value: 20 },
      { event_at: '2024-01-10', group: null, tenant: 'a', value: 20 },
      { event_at: '2024-02-10', group: null, tenant: 'a', value: 60 },
      { event_at: '2023-02-10', group: null, tenant: 'b', value: 999 },
      { event_at: '2024-02-10', group: null, tenant: 'b', value: 999 },
      { event_at: '2023-02-10', group: 'x', tenant: 'a', value: 30 },
      { event_at: '2023-02-10', group: 'y', tenant: 'a', value: 40 },
      { event_at: '2023-01-19 23:30:00', group: 'tz', tenant: 'a', value: 99 },
      { event_at: '2023-01-20 00:30:00', group: 'tz', tenant: 'a', value: 10 },
      { event_at: '2026-03-28 23:30:00', group: 'dst', tenant: 'a', value: 10 },
      { event_at: '2026-03-29 00:30:00', group: 'dst', tenant: 'a', value: 20 },
      { event_at: '2026-03-29 22:30:00', group: 'dst', tenant: 'a', value: 99 },
    ]);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${table}`); });

  it('matches canonical dataset queries and emits the metric alias', async () => {
    const query = { by: 'month' as const, dimensions: ['group'], filters: range,
      orderBy: [{ field: 'group', direction: 'asc' as const }],
    };
    const datasetResult = await client.execute(Events, { ...query, measures: ['priorYtd'] }, context);
    const metricResult = await client.execute(PriorYtd, query, context);
    expect(metricResult.data).toEqual(datasetResult.data.map(({ priorYtd, ...rest }) => ({ ...rest, previousYearToDate: priorYtd })));
    expect(metricResult.data[0]).not.toHaveProperty('priorYtd');
    expect(metricResult.meta?.sql).toContain('AS `previousYearToDate`');
  });
  it('supports standalone formulas without a time grain or range', async () => {
    const result = await client.execute(Average, { filters: range }, context);
    expect(result.data).toEqual([{ averageOrderValue: '60' }]);
  });
  it('executes comparison formulas through their transitive dependencies', async () => {
    const result = await client.execute(Growth.by('month'), { dimensions: ['group'], filters: range }, context);
    expect(result.data.find(row => row.group === null)?.aovGrowth).toBe('2');
    expect(result.data.find(row => row.group === 'x')?.aovGrowth).toBeNull();
  });
  it('orders and paginates after evaluation, using the metric alias', async () => {
    const result = await client.execute(PriorYtd.by('month'), { dimensions: ['group'], filters: range, orderBy: [{ field: 'previousYearToDate', direction: 'desc' }], limit: 2, offset: 1 }, context);
    expect(result.data.map(row => row.previousYearToDate)).toEqual(['40', '30']);
    expect(result.meta?.pagination).toMatchObject({ hasMore: true, limit: 2, offset: 1 });
  });
  it('uses query timezone for shifted source selection', async () => {
    const query = { by: 'day' as const, filters: [
      { field: 'time', operator: 'gte' as const, value: '2024-01-20' }, { field: 'time', operator: 'lt' as const, value: '2024-01-21' },
      { field: 'group', operator: 'eq' as const, value: 'tz' },
    ] };
    expect((await client.execute(PriorRevenue, query, context)).data[0].previousRevenue).toBe('10');
    expect((await client.execute(PriorRevenue, { ...query, timezone: 'Europe/Madrid' }, context)).data[0].previousRevenue).toBe('109');
  });
  it('recalculates shifted formulas inside a prior day with a DST transition', async () => {
    const query = { by: 'day' as const, filters: [
      { field: 'time', operator: 'gte' as const, value: '2027-03-29' }, { field: 'time', operator: 'lt' as const, value: '2027-03-30' },
      { field: 'group', operator: 'eq' as const, value: 'dst' },
    ] };
    expect((await client.execute(PriorAverage, query, context)).data[0].previousAverage).toBe('59.5');
    expect((await client.execute(PriorAverage, { ...query, timezone: 'Europe/Madrid' }, context)).data[0].previousAverage).toBe('15');
  });
  it('rejects a named metric whose year shift lands in a DST gap', async () => {
    const query = { by: 'hour' as const, timezone: 'Europe/Madrid', filters: [
      { field: 'time', operator: 'gte' as const, value: '2027-03-29T01:00:00' },
      { field: 'time', operator: 'lt' as const, value: '2027-03-29T02:00:00' },
      { field: 'group', operator: 'eq' as const, value: 'dst' },
    ] };
    expect((await client.execute(PriorRevenue, query, context)).data[0].previousRevenue).toBe('20');
    await expect(client.execute(PriorRevenue, { ...query, filters: [
      { ...query.filters[0], value: '2027-03-29T02:00:00' },
      { ...query.filters[1], value: '2027-03-29T03:00:00' },
      query.filters[2],
    ] }, context)).rejects.toThrow(/nonexistent local time/);
  });
  it('rejects unsupported grains, missing ranges, missing tenancy and oversized series', async () => {
    expect(client.validate(PriorYtd, { by: 'month' }, context).valid).toBe(false);
    expect(client.validate(PriorYtd, { by: 'year', filters: range }, context).valid).toBe(false);
    expect(client.validate(PriorYtd, { by: 'month', filters: range }).valid).toBe(false);
    expect(() => PriorYtd.by('year')).toThrow(/does not support grain/);
    await expect(client.execute(PriorYtd, { by: 'month', filters: [
      { field: 'time', operator: 'gte', value: '2024-01-01' }, { field: 'time', operator: 'lt', value: '2024-03-01' },
    ], limit: 1 }, context)).rejects.toThrow(/result limit/);
  });
});
