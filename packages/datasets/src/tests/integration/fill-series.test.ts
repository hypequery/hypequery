import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

// RFC 0029 §3: a filled series against ClickHouse.
const table = 'hq0029_fill_series';
const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });
const Orders = dataset('fillOrders', {
  source: table,
  timeKey: 'createdAt',
  dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }), country: dimension.string() },
  measures: { orders: measure.count('country'), revenue: measure.sum('amount') },
  limits: { maxMeasures: 1 },
});
// Starts at noon: the morning row is outside the range though inside its first day.
const range = [
  { field: 'createdAt', operator: 'gte' as const, value: '2026-01-01 12:00:00' },
  { field: 'createdAt', operator: 'lt' as const, value: '2026-01-04' },
];

describe('filled series against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (created_at DateTime64(3, 'UTC'), country String, amount Float64) ENGINE = MergeTree ORDER BY created_at`);
    await insertRows(table, [
      { created_at: '2026-01-01 08:00:00', country: 'FR', amount: 1 },
      { created_at: '2026-01-01 13:00:00', country: 'US', amount: 10 },
      { created_at: '2026-01-03 09:00:00', country: 'US', amount: 20 },
    ]);
  });
  afterAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${table}`);
  });

  it('fills every period for the combinations inside the exact range', async () => {
    const result = await client.execute(Orders, {
      dimensions: ['country'], measures: ['orders'], by: 'day', fill: true, filters: range, orderBy: [{ field: 'period', direction: 'asc' }],
    });
    // FR appears only before noon on the first day, so it gets no rows.
    expect(result.data.map(row => [String(row.period).slice(0, 10), row.country, Number(row.orders)])).toEqual([
      ['2026-01-01', 'US', 1],
      ['2026-01-02', 'US', 0],
      ['2026-01-03', 'US', 1],
    ]);
  });

  it('fills a dimension-only series', async () => {
    const result = await client.execute(Orders, {
      dimensions: ['country'], measures: [], by: 'day', fill: true, filters: range, orderBy: [{ field: 'period', direction: 'asc' }],
    });
    expect(result.data.map(row => [String(row.period).slice(0, 10), row.country])).toEqual([
      ['2026-01-01', 'US'],
      ['2026-01-02', 'US'],
      ['2026-01-03', 'US'],
    ]);
  });

  it('fills the default measures under maxMeasures when none is named', async () => {
    const result = await client.execute(Orders, { by: 'day', fill: true, filters: range, orderBy: [{ field: 'period', direction: 'asc' }] });
    expect(result.data.map(row => [Number(row.orders), row.revenue === null ? null : Number(row.revenue)])).toEqual([
      [1, 10],
      [0, null],
      [1, 20],
    ]);
  });
});
