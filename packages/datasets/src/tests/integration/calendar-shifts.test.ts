import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, multiply } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq_calendar_shift';
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('calendarShiftEvents', {
  source: table, timeKey: 'time', dimensions: { time: dimension.timestamp(), group: dimension.string() },
  measures: {
    revenue: measure.sum('value'), priorYear: measure.shift('revenue', { amount: 1, unit: 'year' }),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
    // A shifted formula evaluates its inputs in a shifted context rather than
    // through the per-bucket shift ranges, so it exercises the other code path.
    doubled: measure.derived({ uses: { revenue: 'revenue' }, formula: ({ revenue }) => multiply(revenue, 2) }),
    priorMonthDoubled: measure.shift('doubled', { amount: 1, unit: 'month' }),
  },
});

describe('calendar shifts at fine grains', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (time DateTime64(9, 'UTC'), group String, value Float64) ENGINE=Memory`);
    await insertRows(table, [
      { time: '2023-02-28 12:15:00', group: 'leap', value: 10 },
      { time: '2024-02-28 12:15:00', group: 'leap', value: 20 },
      { time: '2024-02-29 12:15:00', group: 'leap', value: 30 },
      { time: '2023-01-28 12:00:00', group: 'mapped', value: 1 },
      { time: '2023-01-29 12:00:00', group: 'unmapped', value: 99 },
      { time: '2023-02-01 12:00:00', group: 'mapped', value: 2 },
      { time: '2024-02-03 12:00:00', group: 'week', value: 3 },
      { time: '2024-02-09 12:00:00', group: 'week', value: 9 },
      { time: '2024-02-10 12:00:00', group: 'week', value: 100 },
      // Partial weeks (HQ-330). Values hold for Sunday and Monday weeks alike.
      { time: '2024-01-29 12:00:00', group: 'lead', value: 600 },
      { time: '2024-01-30 12:00:00', group: 'lead', value: 4 },
      { time: '2024-02-02 12:00:00', group: 'lead', value: 50 },
      { time: '2024-01-28 12:00:00', group: 'both', value: 600 },
      { time: '2024-01-29 12:00:00', group: 'both', value: 4 },
      { time: '2024-01-31 12:00:00', group: 'both', value: 50 },
      { time: '2024-02-01 12:00:00', group: 'both', value: 7000 },
      { time: '2024-02-29 08:00:00', group: 'overlap', value: 2 },
      { time: '2024-02-29 15:00:00', group: 'overlap', value: 7 },
      { time: '2024-02-29 15:00:00', group: 'overlap', value: 7 },
    ]);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${table}`); });

  it('clamps a leap day while preserving both full daily buckets', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['revenue', 'priorYear'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-02-28' }, { field: 'time', operator: 'lt', value: '2024-03-01' }, { field: 'group', operator: 'eq', value: 'leap' }] });
    expect(result.data.map(row => [row.revenue, row.priorYear])).toEqual([['20', '10'], ['30', '10']]);
  });

  it('maps month-end days to nonempty target days', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['priorMonth'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-03-29' }, { field: 'time', operator: 'lt', value: '2024-04-01' }, { field: 'group', operator: 'eq', value: 'leap' }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['30', '30', '30']);
  });

  it('preserves partial hourly bounds on a clamped date', async () => {
    const result = await client.execute(Events, { by: 'hour', measures: ['revenue', 'priorYear'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-02-29T11:30:00' }, { field: 'time', operator: 'lt', value: '2024-02-29T12:30:00' }, { field: 'group', operator: 'eq', value: 'leap' }] });
    expect(result.data.map(row => [row.revenue, row.priorYear])).toEqual([[null, null], ['30', '10']]);
  });

  it('excludes dimensions from source dates no output bucket maps to', async () => {
    const result = await client.execute(Events, { by: 'day', dimensions: ['group'], measures: ['priorMonth'],
      filters: [{ field: 'time', operator: 'gte', value: '2023-02-28' }, { field: 'time', operator: 'lt', value: '2023-03-02' }] });
    expect(result.data.map(row => [row.group, row.priorMonth])).toEqual([['mapped', '1'], ['mapped', '2']]);
  });

  it('keeps seven calendar days when a month shift starts between source weeks', async () => {
    const result = await client.execute(Events, { by: 'week', measures: ['priorMonth'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-03-03' }, { field: 'time', operator: 'lt', value: '2024-03-10' }, { field: 'group', operator: 'eq', value: 'week' }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['12']);
  });

  it('keeps a partial leading week inside its shifted week', async () => {
    // The first week is cut to 2024-03-01 onwards. The full week maps to its
    // start minus one month plus seven days; the selected days map to the
    // matching slice of that range, which ends on 2024-01-31 inclusive. The
    // bound used to be 2024-03-01 minus one month (2024-02-01), past the end
    // of the shifted week, so the range was empty and the bucket read null.
    const result = await client.execute(Events, { by: 'week', measures: ['priorMonth', 'priorMonthDoubled'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-03-01' }, { field: 'time', operator: 'lt', value: '2024-03-10' }, { field: 'group', operator: 'eq', value: 'lead' }] });
    expect(result.data.map(row => [row.priorMonth, row.priorMonthDoubled])).toEqual([['4', '8'], [null, null]]);
  });

  it('keeps a week cut on both sides inside its shifted week', async () => {
    // Thursday 2024-02-29 to Saturday 2024-03-02 maps to 2024-01-29–2024-01-31.
    // Shifting the upper bound on its own gave 2024-02-02 and pulled in rows
    // from days the bucket never covered.
    const result = await client.execute(Events, { by: 'week', measures: ['priorMonth', 'priorMonthDoubled'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-02-29' }, { field: 'time', operator: 'lt', value: '2024-03-02' }, { field: 'group', operator: 'eq', value: 'both' }] });
    expect(result.data.map(row => [row.priorMonth, row.priorMonthDoubled])).toEqual([['4', '8']]);
  });

  it('preserves source multiplicity when clamped buckets overlap', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['priorMonth'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-03-30' }, { field: 'time', operator: 'lt', value: '2024-04-01' }, { field: 'group', operator: 'eq', value: 'overlap' }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['16', '16']);
  });

  it('keeps both sides of overlapping partial month-end buckets', async () => {
    const result = await client.execute(Events, { by: 'day', measures: ['priorMonth'],
      filters: [{ field: 'time', operator: 'gte', value: '2024-03-30T13:00:00' }, { field: 'time', operator: 'lt', value: '2024-03-31T10:00:00' }, { field: 'group', operator: 'eq', value: 'overlap' }] });
    expect(result.data.map(row => row.priorMonth)).toEqual(['14', '2']);
  });

  it('rejects a calendar shift into a nonexistent local hour even with no source rows', async () => {
    const query = { by: 'hour' as const, timezone: 'Europe/Madrid', measures: ['priorYear'], filters: [
      { field: 'time', operator: 'gte' as const, value: '2025-03-31T01:00:00' },
      { field: 'time', operator: 'lt' as const, value: '2025-03-31T04:00:00' },
    ] };
    await expect(client.execute(Events, query)).rejects.toThrow(/nonexistent local time/);
  });

  it('retains an adjacent valid hour when the following prior-year hour is skipped', async () => {
    const result = await client.execute(Events, { by: 'hour', timezone: 'Europe/Madrid', measures: ['priorYear'], filters: [
      { field: 'time', operator: 'gte', value: '2025-03-31T01:00:00' },
      { field: 'time', operator: 'lt', value: '2025-03-31T02:00:00' },
    ] });
    expect(result.data).toHaveLength(1);
  });

  it('rejects a half-hour daylight-saving gap at minute grain', async () => {
    await expect(client.execute(Events, { by: 'minute', timezone: 'Australia/Lord_Howe', measures: ['priorYear'], filters: [
      { field: 'time', operator: 'gte', value: '2026-10-05T02:15:00' },
      { field: 'time', operator: 'lt', value: '2026-10-05T02:16:00' },
    ] })).rejects.toThrow(/nonexistent local time/);
  });
});
