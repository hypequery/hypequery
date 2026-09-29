import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure } from '../../index.js';
import { TEST_CONNECTION_CONFIG as config, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'hq_calendar_shift';
const db = createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database });
const client = createDatasetClient({ queryBuilder: db });
const Events = dataset('calendarShiftEvents', {
  source: table, timeKey: 'time', dimensions: { time: dimension.timestamp(), group: dimension.string() },
  measures: {
    revenue: measure.sum('value'), priorYear: measure.shift('revenue', { amount: 1, unit: 'year' }),
    priorMonth: measure.shift('revenue', { amount: 1, unit: 'month' }),
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
});
