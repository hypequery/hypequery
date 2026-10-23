import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide } from './formulas.js';
import { belongsTo } from './relationships.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { serializeSemanticContract } from './contract.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { buildDatasetPlan } from './semantic-planner.js';
import { datasetBuilderSource } from './utils/resolved-row-source.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';

const policy = { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' } as const;
const Users = dataset('users', {
  source: 'analytics.users', rowResolution: policy,
  dimensions: { id: dimension.number(), amount: dimension.number(), at: dimension.timestamp() },
  timeKey: 'at', measures: { total: measure.sum('amount'), count: measure.count('id') },
});
const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });

describe('resolved row dataset sources', () => {
  it('resolves before deletion and user predicates, without rewriting the source identifier', () => {
    const statement = client.compileDataset(Users, { measures: ['total'], filters: [{ field: 'amount', operator: 'gt', value: 10 }] });
    expect(statement.sql).toContain('FROM `analytics`.`users` FINAL WHERE `is_deleted` = 0 SETTINGS optimize_move_to_prewhere = 0');
    expect(statement.sql).toContain(') AS `users`');
    expect(statement.parameters).toEqual([10]);
    expect(Users.source).toBe('analytics.users');
  });
  it('resolves relationship targets and keeps base qualifiers valid', () => {
    const Orders = dataset('orders', { source: 'orders', rowResolution: policy,
      dimensions: { id: dimension.number(), user_id: dimension.number(), amount: dimension.number() },
      measures: { total: measure.sum('amount') },
      relationships: { user: belongsTo(() => Users, { from: 'user_id', to: 'id' }) },
    });
    const sql = client.toSQL(Orders, { dimensions: ['user.id'], measures: ['total'] });
    expect(sql.match(/FINAL/g)).toHaveLength(2);
    expect(sql).toContain('orders.amount');
    expect(sql).toContain('FROM (SELECT * FROM `analytics`.`users` FINAL');
  });
  it('carries policy through deployment rehydration and cache identity', () => {
    const contract = buildProtocolDeploymentContract([Users]);
    const hydrated = rehydrateProtocolDatasets(contract.datasets);
    expect(hydrated.users.rowResolution).toEqual(policy);
    expect(client.toSQL(hydrated.users, { measures: ['total'] })).toContain('FINAL');
    const raw = dataset('users', { source: Users.source, dimensions: Users.dimensions, measures: Users.measures });
    expect(serializeSemanticContract({ users: Users }).contentHash).not.toBe(serializeSemanticContract({ users: raw }).contentHash);
    expect(buildDatasetQuerySignature(Users, {})).not.toBe(buildDatasetQuerySignature(raw, {}));
  });
  it('rejects unsupported engines, dialects and frozen backend rather than counting raw rows', () => {
    expect(() => dataset('bad', { source: 'bad', dimensions: {}, rowResolution: { kind: 'final', engine: 'aggregating' } as never })).toThrow();
    expect(() => datasetBuilderSource(Users, { ...clickhouseDatasetSqlDialect, name: 'postgres' })).toThrow('ClickHouse');
    expect(() => buildDatasetPlan(Users)).toThrow('queryBuilder');
  });
  it('resolves both base and derived metric scans', () => {
    const total = Users.metric('total', { measure: 'total' });
    const rows = Users.metric('rows', { measure: 'count' });
    const avg = Users.metric('mean', { uses: { total, rows }, formula: ({ total, rows }) => divide(total, rows) });
    expect(client.toSQL(total)).toContain('FINAL');
    expect(client.toSQL(avg)).toContain('FINAL');
  });
  it('collapsing policies apply the sign test after FINAL', () => {
    const Collapsing = dataset('collapsing', { source: 'collapsing', dimensions: { id: dimension.number() }, rowResolution: { kind: 'final', engine: 'collapsing', signColumn: 'sign' }, measures: { rows: measure.count('id') } });
    expect(client.toSQL(Collapsing, { measures: ['rows'] })).toContain('FINAL WHERE `sign` = 1');
  });
});
