import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { belongsTo } from '../../relationships.js';
import { checkRelationships } from '../../relationship-check.js';
import { buildProtocolDeploymentContract } from '../../protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from '../../protocol-rehydrate.js';
import { TEST_CONNECTION_CONFIG, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const db = createQueryBuilder({ host: TEST_CONNECTION_CONFIG.host, username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password, database: TEST_CONNECTION_CONFIG.database,
  clickhouseSettings: { optimize_move_to_prewhere: 1, optimize_move_to_prewhere_if_final: 1 } });
const client = createDatasetClient({ queryBuilder: db });
const source = 'resolved_rows_versions';
const policy = { kind: 'final', engine: 'replacing', deletedColumn: 'deleted' } as const;
const Versions = dataset('versions', { source, rowResolution: policy,
  tenantKey: 'tenant', timeKey: 'at',
  dimensions: { id: dimension.number(), amount: dimension.number(), plan: dimension.string(), at: dimension.timestamp() },
  measures: { total: measure.sum('amount'), rows: measure.count('id'), mean: measure.avg('amount'), running: measure.cumulative('total') },
});
const Orders = dataset('orders', { source: 'resolved_rows_orders',
  dimensions: { id: dimension.number() }, measures: { rows: measure.count('id') },
  relationships: { current: belongsTo(() => Versions, { from: 'id', to: 'id' }) },
});
const context = { runtime: { tenant: { id: 'a' } } };
const tables = [source, 'resolved_rows_orders', 'resolved_rows_collapsing', 'resolved_rows_versioned_collapsing'];

describe('resolved rows match independent FINAL totals on ClickHouse', () => {
  beforeAll(async () => {
    await runSql('DROP USER IF EXISTS resolved_rows_reader');
    await runSql('CREATE USER resolved_rows_reader IDENTIFIED WITH no_password SETTINGS readonly=2');
    await runSql(`GRANT SELECT ON ${TEST_CONNECTION_CONFIG.database}.* TO resolved_rows_reader`);
    for (const table of tables) await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql(`CREATE TABLE ${source} (id UInt64, tenant String, amount Float64, plan String, at DateTime, version UInt64, deleted UInt8) ENGINE = ReplacingMergeTree(version) ORDER BY id`);
    await runSql(`SYSTEM STOP MERGES ${source}`);
    await runSql(`INSERT INTO ${source} VALUES (1,'a',10,'old','2026-03-01',1,0), (2,'a',20,'old','2026-03-01',1,0), (3,'a',5,'old','2026-03-02',1,0), (4,'a',3,'old','2026-03-02',1,0)`);
    await runSql(`INSERT INTO ${source} VALUES (1,'a',100,'deleted','2026-03-01',2,1), (2,'a',30,'gold','2026-03-01',2,0), (3,'a',7,'gold','2026-03-02',2,0), (4,'b',8,'gold','2026-03-02',2,0)`);
    await runSql('CREATE TABLE resolved_rows_orders (id UInt64) ENGINE = MergeTree ORDER BY id');
    await runSql('INSERT INTO resolved_rows_orders VALUES (1), (2), (3)');
    for (const [table, engine] of [['resolved_rows_collapsing', 'CollapsingMergeTree(sign)'], ['resolved_rows_versioned_collapsing', 'VersionedCollapsingMergeTree(sign, version)']]) {
      await runSql(`CREATE TABLE ${table} (id UInt64, amount Float64, sign Int8, version UInt64) ENGINE = ${engine} ORDER BY id`);
      await runSql(`SYSTEM STOP MERGES ${table}`);
      await runSql(`INSERT INTO ${table} VALUES (1,30,1,1), (2,40,1,1)`);
      await runSql(`INSERT INTO ${table} VALUES (1,30,-1,1), (3,9,-1,1)`);
    }
  });
  afterAll(async () => { for (const table of tables) await runSql(`DROP TABLE IF EXISTS ${table}`); await runSql("DROP USER IF EXISTS resolved_rows_reader"); });

  it('reconciles sum/count/avg, excludes deleted rows and never resurrects an old tenant', async () => {
    const expected = await db.rawQuery(`SELECT sum(amount) AS total, count(id) AS rows, avg(amount) AS mean FROM ${source} FINAL WHERE deleted=0 AND tenant='a' SETTINGS optimize_move_to_prewhere=0`);
    const actual = await client.execute(Versions, { measures: ['total', 'rows', 'mean'] }, context);
    expect(actual.data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])))).toEqual(expected.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]))));
    expect(Number(actual.data[0].total)).toBe(37);
    const raw = await db.rawQuery<{ total: number }>(`SELECT sum(amount) AS total FROM ${source} WHERE deleted=0 AND tenant='a'`);
    expect(Number(raw[0].total)).toBeGreaterThan(37);
  });
  it('executes through a least-privilege readonly=2 connection', async () => {
    const readonlyClient = createDatasetClient({ queryBuilder: createQueryBuilder({
      host: TEST_CONNECTION_CONFIG.host, username: 'resolved_rows_reader', password: '',
      database: TEST_CONNECTION_CONFIG.database,
    }) });
    const result = await readonlyClient.execute(Versions, { measures: ['total'] }, context);
    expect(Number(result.data[0].total)).toBe(37);
  });
  it('does not leak an old row through a non-key query predicate', async () => {
    const result = await client.execute(Versions, { measures: ['rows'], filters: [{ field: 'plan', operator: 'eq', value: 'old' }] }, context);
    expect(Number(result.data[0].rows)).toBe(0);
  });
  it('resolves related dimensions and key checks before ANY JOIN', async () => {
    const result = await client.execute(Orders, { dimensions: ['current.plan'], measures: ['rows'], orderBy: [{ field: 'current.plan', direction: 'asc' }] }, context);
    expect(result.data).toEqual(expect.arrayContaining([{ 'current.plan': 'gold', rows: '2' }, { 'current.plan': null, rows: '1' }]));
    expect((await checkRelationships(Orders, { queryBuilder: db, context })).ok).toBe(true);
  });
  it('retains resolved sources in time scans and deployment rehydration', async () => {
    const time = await client.execute(Versions, { measures: ['total', 'running'], by: 'day', filters: [{ field: 'at', operator: 'between', value: ['2026-03-01T00:00:00Z', '2026-03-02T23:59:59Z'] }] }, context);
    expect(time.data.map(row => Number(row.total))).toEqual([30, 7]);
    expect(time.data.map(row => Number(row.running))).toEqual([30, 37]);
    const { running: _running, ...baseMeasures } = Versions.measures;
    const Portable = dataset('versions', { source, rowResolution: policy, tenantKey: 'tenant', dimensions: Versions.dimensions, measures: baseMeasures });
    const roundtrip = rehydrateProtocolDatasets(buildProtocolDeploymentContract([Portable]).datasets).versions;
    const result = await client.execute(roundtrip, { measures: ['total'] }, context);
    expect(Number(result.data[0].total)).toBe(37);
  });
  it.each([['resolved_rows_collapsing', 'collapsing'], ['resolved_rows_versioned_collapsing', 'versioned-collapsing']] as const)('resolves signs in %s', async (table, engine) => {
    const Collapsed = dataset('collapsed', { source: table, rowResolution: { kind: 'final', engine, signColumn: 'sign' }, dimensions: { id: dimension.number(), amount: dimension.number() }, measures: { total: measure.sum('amount'), rows: measure.count('id') } });
    const result = await client.execute(Collapsed, { measures: ['total', 'rows'] });
    expect(Number(result.data[0].total)).toBe(40);
    expect(Number(result.data[0].rows)).toBe(1);
  });
});
