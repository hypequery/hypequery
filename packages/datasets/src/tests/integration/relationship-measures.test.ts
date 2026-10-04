import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset, dimension, measure, belongsTo, hasOne, createDatasetClient, add } from '../../index.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const sourceTable = 'hq83_sources';
const targetTable = 'hq83_targets';
const Targets = dataset('hq83Targets', {
  source: targetTable, tenantKey: 'tenant',
  dimensions: { id: dimension.number(), score: dimension.number(), tier: dimension.string() },
  measures: {
    unique: measure.countDistinct('id'), estimated: measure.approxCountDistinct('id'),
    lowest: measure.min('score'), highest: measure.max('score'),
    latest: measure.argMax('tier', 'score'), earliest: measure.argMin('tier', 'score'),
    gold: measure.countDistinct('id', { filters: [{ field: 'tier', operator: 'eq', value: 'gold' }] }),
    total: measure.sum('score'), count: measure.count('id'), average: measure.avg('score'),
  },
});
const Sources = dataset('hq83Sources', {
  source: sourceTable, tenantKey: 'tenant', timeKey: 'time',
  dimensions: { status: dimension.string(), amount: dimension.number(), time: dimension.timestamp() },
  measures: { revenue: measure.sum('amount'), double: measure.derived({ uses: { revenue: 'revenue' }, formula: ({ revenue }) => add(revenue, revenue) }), running: measure.cumulative('revenue'), priorDouble: measure.shift('double', { amount: 1, unit: 'day' }) },
  segments: { paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] } },
  relationships: { target: belongsTo(() => Targets, { from: 'target_id', to: 'id' }), profile: hasOne(() => Targets, { from: 'id', to: 'id' }) },
});
const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user, password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database });
const client = createDatasetClient({ queryBuilder: db });
const context = { runtime: { tenant: { id: 'a' } } };

describe('relationship measures against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${sourceTable} (id UInt64, target_id UInt64, amount Float64, status String, tenant String, time DateTime) ENGINE = MergeTree ORDER BY id`);
    await runSql(`CREATE TABLE ${targetTable} (id UInt64, score Float64, tier String, tenant String) ENGINE = MergeTree ORDER BY id`);
    await insertRows(sourceTable, [
      { id: 1, target_id: 1, amount: 10, status: 'paid', tenant: 'a', time: '2026-01-01 12:00:00' },
      { id: 2, target_id: 1, amount: 20, status: 'paid', tenant: 'a', time: '2026-01-01 12:00:00' },
      { id: 3, target_id: 2, amount: 30, status: 'open', tenant: 'a', time: '2026-01-02 12:00:00' },
      { id: 4, target_id: 99, amount: 40, status: 'missing', tenant: 'a', time: '2026-01-02 12:00:00' },
      { id: 5, target_id: 3, amount: 50, status: 'foreign', tenant: 'a', time: '2026-01-02 12:00:00' },
      { id: 6, target_id: 3, amount: 900, status: 'paid', tenant: 'b', time: '2026-01-01 12:00:00' },
    ]);
    await insertRows(targetTable, [
      { id: 1, score: 5, tier: 'gold', tenant: 'a' }, { id: 2, score: 10, tier: 'silver', tenant: 'a' },
      { id: 3, score: 900, tier: 'secret', tenant: 'b' }, { id: 99, score: 999, tier: 'unreached', tenant: 'b' },
      { id: 7, score: 1, tier: 'unreached', tenant: 'a' },
    ]);
  });
  afterAll(async () => { await runSql(`DROP TABLE IF EXISTS ${sourceTable}`); await runSql(`DROP TABLE IF EXISTS ${targetTable}`); });

  it('deduplicates belongsTo targets without losing base rows or leaking tenants', async () => {
    const { data } = await client.execute(Sources, { measures: ['revenue', 'target.unique', 'target.estimated', 'target.lowest', 'target.highest', 'target.gold', 'target.latest', 'target.earliest'] }, context);
    expect(data).toEqual([{ revenue: '150', 'target.unique': '2', 'target.estimated': '2', 'target.lowest': '5', 'target.highest': '10', 'target.gold': '1', 'target.latest': 'silver', 'target.earliest': 'gold' }]);
  });
  it('uses the base segment/filter population and sorts dotted measure aliases', async () => {
    const { data } = await client.execute(Sources, { dimensions: ['status'], measures: ['target.unique'], segments: ['paid'], filters: [{ field: 'amount', operator: 'gt', value: 15 }], orderBy: [{ field: 'target.unique', direction: 'desc' }] }, context);
    expect(data).toEqual([{ status: 'paid', 'target.unique': '1' }]);
  });
  it('does not invent target values for unmatched groups under ClickHouse default joins', async () => {
    const { data } = await client.execute(Sources, { dimensions: ['status'], measures: ['target.unique', 'target.lowest'], filters: [{ field: 'status', operator: 'eq', value: 'missing' }] }, context);
    expect(data).toEqual([{ status: 'missing', 'target.unique': '0', 'target.lowest': null }]);
  });
  it('allows additive and count aggregates over declared hasOne targets', async () => {
    const { data } = await client.execute(Sources, { measures: ['profile.count', 'profile.total', 'profile.average'] }, context);
    expect(data).toEqual([{ 'profile.count': '2', 'profile.total': '15', 'profile.average': '7.5' }]);
  });
  it('keeps qualified output beside a local derived measure', async () => {
    const { data } = await client.execute(Sources, { measures: ['double', 'target.unique'] }, context);
    expect(data).toEqual([{ double: '300', 'target.unique': '2' }]);
  });
  it('composes target aggregates with local time measures', async () => {
    const { data } = await client.execute(Sources, { measures: ['running', 'target.unique'], by: 'day', filters: [{ field: 'time', operator: 'gte', value: '2026-01-01' }, { field: 'time', operator: 'lt', value: '2026-01-03' }] }, context);
    expect(data.map(row => ({ running: row.running, unique: row['target.unique'] }))).toEqual([{ running: '30', unique: '1' }, { running: '150', unique: '1' }]);
  });
  it('composes target aggregates with a shift of a local derived measure', async () => {
    const { data } = await client.execute(Sources, { measures: ['priorDouble', 'target.unique'], by: 'day', filters: [{ field: 'time', operator: 'gte', value: '2026-01-02' }, { field: 'time', operator: 'lt', value: '2026-01-03' }] }, context);
    expect(data.map(row => ({ prior: row.priorDouble, unique: row['target.unique'] }))).toEqual([{ prior: '60', unique: '1' }]);
  });

});
