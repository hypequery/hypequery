import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset, dimension, measure, belongsTo, createDatasetClient, checkRelationships } from '../../index.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const sourceTable = 'composite_orders';
const targetTable = 'composite_customers';
const Targets = dataset('compositeLiveCustomers', {
  source: targetTable, tenantKey: 'tenant', dimensions: { tier: dimension.string() },
  measures: { count: measure.countDistinct('row_key'), lowest: measure.min('score') },
});
const Sources = dataset('compositeLiveOrders', {
  source: sourceTable, tenantKey: 'tenant', timeKey: 'time',
  dimensions: { status: dimension.string(), time: dimension.timestamp() },
  measures: { revenue: measure.sum('amount'), running: measure.cumulative('revenue') },
  relationships: { customer: belongsTo(() => Targets, { keys: [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }] }) },
});
const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });
const context = { runtime: { tenant: { id: 'a' } } };

describe('composite relationships against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${sourceTable} (customer_id Nullable(UInt64), region_code Nullable(String), amount Float64, status String, tenant String, time DateTime) ENGINE = MergeTree ORDER BY tuple()`);
    await runSql(`CREATE TABLE ${targetTable} (id Nullable(UInt64), region Nullable(String), row_key String, score Float64, tier String, tenant String) ENGINE = MergeTree ORDER BY tuple()`);
    await insertRows(targetTable, [
      { id: 1, region: 'US', row_key: '1US', score: 5, tier: 'gold', tenant: 'a' },
      { id: 1, region: 'EU', row_key: '1EU', score: 10, tier: 'silver', tenant: 'a' },
      { id: 1, region: 'EU', row_key: '1EU-b', score: 900, tier: 'secret', tenant: 'b' },
      { id: null, region: 'EU', row_key: 'nullEU', score: 999, tier: 'null-id', tenant: 'a' },
      { id: 1, region: null, row_key: '1null', score: 999, tier: 'null-region', tenant: 'a' },
      { id: 1, region: null, row_key: '1null-duplicate', score: 999, tier: 'null-region', tenant: 'a' },
    ]);
    await insertRows(sourceTable, [
      { customer_id: 1, region_code: 'US', amount: 10, status: 'paid', tenant: 'a', time: '2026-01-01 12:00:00' },
      { customer_id: 1, region_code: 'US', amount: 20, status: 'paid', tenant: 'a', time: '2026-01-01 12:00:00' },
      { customer_id: 1, region_code: 'EU', amount: 30, status: 'paid', tenant: 'a', time: '2026-01-02 12:00:00' },
      { customer_id: 1, region_code: 'AP', amount: 40, status: 'missing', tenant: 'a', time: '2026-01-02 12:00:00' },
      { customer_id: null, region_code: 'EU', amount: 50, status: 'null', tenant: 'a', time: '2026-01-02 12:00:00' },
      { customer_id: 1, region_code: null, amount: 60, status: 'null', tenant: 'a', time: '2026-01-02 12:00:00' },
      { customer_id: 1, region_code: 'EU', amount: 900, status: 'paid', tenant: 'b', time: '2026-01-02 12:00:00' },
    ]);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${sourceTable}`); await runSql(`DROP TABLE IF EXISTS ${targetTable}`); });
  it('matches the full key, preserves unmatched rows and scopes tenants', async () => {
    const { data } = await client.execute(Sources, { dimensions: ['customer.tier'], measures: ['revenue', 'customer.count'], orderBy: [{ field: 'revenue', direction: 'asc' }] }, context);
    expect(data.filter(row => row['customer.count'] !== '0')).toEqual([{ 'customer.tier': 'gold', revenue: '30', 'customer.count': '1' }, { 'customer.tier': 'silver', revenue: '30', 'customer.count': '1' }]);
    expect(data.reduce((sum, row) => sum + Number(row.revenue), 0)).toBe(210);
    expect(data.some(row => row['customer.tier'] === 'secret' || row['customer.tier'] === 'null-region' || row['customer.tier'] === 'null-id')).toBe(false);
  });
  it('filters on a joined dimension using the full key', async () => {
    expect((await client.execute(Sources, { measures: ['revenue'], filters: [{ field: 'customer.tier', operator: 'eq', value: 'silver' }] }, context)).data).toEqual([{ revenue: '30' }]);
  });
  it('uses all hidden target key columns for related aggregates', async () => {
    expect((await client.execute(Sources, { measures: ['customer.count', 'customer.lowest'] }, context)).data).toEqual([{ 'customer.count': '2', 'customer.lowest': '5' }]);
  });
  it('checks combined uniqueness and ignores partially NULL target keys', async () => {
    expect(await checkRelationships(Sources, { queryBuilder: db, context })).toEqual({ ok: true, checked: ['customer'], issues: [] });
    const all = await checkRelationships(Sources, { queryBuilder: db, context: { runtime: { tenant: { scope: 'all' } } } });
    expect(all.issues).toEqual([expect.objectContaining({ columns: ['id', 'region'], rows: 3, distinctKeys: 2 })]);
  });
  it('supports composite joins in the time-measure source', async () => {
    const { data } = await client.execute(Sources, { measures: ['running', 'customer.count'], by: 'day', filters: [{ field: 'time', operator: 'gte', value: '2026-01-01' }, { field: 'time', operator: 'lt', value: '2026-01-03' }] }, context);
    expect(data.map(row => [row.running, row['customer.count']])).toEqual([['30', '1'], ['210', '1']]);
  });
  it('uses the same composite traversal for metric queries', async () => {
    const revenue = Sources.metric('revenue', { measure: 'revenue' });
    expect((await client.execute(revenue, { filters: [{ field: 'customer.tier', operator: 'eq', value: 'silver' }] }, context)).data).toEqual([{ revenue: '30' }]);
  });

});
