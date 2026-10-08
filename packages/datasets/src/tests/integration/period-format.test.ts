import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure } from '../../index.js';
import type { TimeGrain } from '../../types.js';
import { TEST_CONNECTION_CONFIG as config, runSql } from '../../../../../testing/clickhouse/harness.mjs';

interface PeriodCase { grain: TimeGrain; timezone: string; instant: string; period: string }

const { cases } = JSON.parse(readFileSync(
  new URL('../../../../../specs/datasets/period-format-v1.json', import.meta.url), 'utf8',
)) as { cases: PeriodCase[] };
const table = 'hq_period_format';
const client = createDatasetClient({
  queryBuilder: createQueryBuilder({ host: config.host, username: config.user, password: config.password, database: config.database }),
});
const Events = dataset('periodEvents', {
  source: table, timeKey: 'occurred_at',
  dimensions: { at: dimension.timestamp({ column: 'occurred_at' }) },
  measures: { rows: measure.count('occurred_at') },
});

// Python runs the same fixture; both must emit identical period text.
describe('period result form shared with Python', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${table} (occurred_at DateTime64(3, 'UTC')) ENGINE=Memory`);
    const instants = [...new Set(cases.map(item => item.instant))];
    await runSql(`INSERT INTO ${table} VALUES ${instants.map(instant => `(parseDateTime64BestEffort('${instant}', 3, 'UTC'))`).join(', ')}`);
  });
  afterAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${table}`);
  });

  it.each(cases)('renders a $grain bucket in $timezone as $period', async ({ grain, timezone, instant, period }) => {
    const result = await client.execute(Events, {
      by: grain, timezone, measures: ['rows'],
      filters: [{ field: 'at', operator: 'eq', value: instant }],
    });
    expect(result.data.map(row => row.period)).toEqual([period]);
  });
});
