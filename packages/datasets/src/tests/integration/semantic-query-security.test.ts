import { beforeAll, afterAll, expect, it } from 'vitest';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { divide, nullIfZero } from '../../formulas.js';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import type { MetricQuery, DatasetQuery } from '../../types.js';
import { TEST_CONNECTION_CONFIG, runSql, insertRows } from '../../../../../testing/clickhouse/harness.mjs';

const table = 'SECURITY_REVIEW_ISOLATION';
const Sales = dataset('securityReview', {
  source: table, tenantKey: 'tenant',
  dimensions: { tenant: dimension.string(), amount: dimension.number({ column: 'AMOUNT' }), id: dimension.number() },
  measures: { revenue: measure.sum('amount'), count: measure.count('id') },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const Average = Sales.metric('average', {
  uses: { revenue: Revenue, count: Sales.metric('count', { measure: 'count' }) },
  formula: ({ revenue, count }) => divide(revenue, nullIfZero(count)),
});
const rows = [{ tenant: 'A', AMOUNT: 10, id: 1 }, { tenant: 'B', AMOUNT: 900, id: 2 }];
const factory = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: factory });

beforeAll(async () => {
  await runSql(`CREATE TABLE ${TEST_CONNECTION_CONFIG.database}.${table} (tenant String, AMOUNT Float64, id UInt32) ENGINE=Memory`);
  await insertRows(table, rows);
});
afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${TEST_CONNECTION_CONFIG.database}.${table}`); });

it('rejects derived metric ordering that attempts an unscoped SELECT', async () => {
  const context = { runtime: { tenant: 'A' } };
  const baseline = await client.execute(Average, {}, context);
  expect(Number(baseline.data[0]?.average)).toBe(10);
  const query = { orderBy: [{ field: 'average', direction: `asc UNION ALL SELECT SUM(amount) FROM ${table}` }] } as unknown as MetricQuery;
  expect(client.validate(Average, query, context).valid).toBe(false);
  await expect(client.execute(Average, query, context)).rejects.toThrow('Invalid order direction');
});

it('rejects a raw subquery operator that attempts to bypass tenancy', async () => {
  const query = { measures: ['revenue'], filters: [{ field: 'id', operator: 'inSubquery', value: 'SELECT id FROM SECURITY_REVIEW_ISOLATION) OR 1=1 --' }] } as unknown as DatasetQuery;
  const context = { runtime: { tenant: 'A' } };
  expect(client.validate(Sales, query, context).valid).toBe(false);
  expect(() => client.execute(Sales, query, context)).toThrow('Unsupported semantic filter operator');
  expect(Number((await client.execute(Sales, { measures: ['revenue'] }, context)).data[0]?.revenue)).toBe(10);
});
