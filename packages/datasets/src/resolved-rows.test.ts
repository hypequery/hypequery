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

const policy = { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' } as const;
const Users = dataset('users', {
  source: 'analytics.users', rowResolution: policy,
  dimensions: { id: dimension.number(), amount: dimension.number(), at: dimension.timestamp() },
  timeKey: 'at', measures: { total: measure.sum('amount'), count: measure.count('id') },
});
const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });

describe('resolved row dataset sources', () => {
  it('reads the source in place with FINAL and keeps only rows that are not deleted', () => {
    const statement = client.compileDataset(Users, { measures: ['total'], filters: [{ field: 'amount', operator: 'gt', value: 10 }] });
    expect(statement.sql).toBe('SELECT SUM(amount) AS `total` FROM analytics.users FINAL WHERE analytics.users.is_deleted = ? AND amount > ?');
    expect(statement.parameters).toEqual([0, 10]);
    expect(Users.final).toBe(true);
    expect(Users.source).toBe('analytics.users');
  });
  it('keeps SQL fields that name the database-qualified source valid', () => {
    const Qualified = dataset('users', {
      source: 'analytics.users', rowResolution: policy,
      dimensions: { id: dimension.number() },
      measures: { total: measure.sum('amount', { sql: 'analytics.users.amount' }) },
    });
    expect(client.toSQL(Qualified, { measures: ['total'] })).toContain('analytics.users.amount) AS `total` FROM analytics.users FINAL');
  });
  it('resolves relationship targets and keeps base qualifiers valid', () => {
    const Orders = dataset('orders', { source: 'orders', rowResolution: policy,
      dimensions: { id: dimension.number(), user_id: dimension.number(), amount: dimension.number() },
      measures: { total: measure.sum('amount') },
      relationships: { user: belongsTo(() => Users, { from: 'user_id', to: 'id' }) },
    });
    const sql = client.toSQL(Orders, { dimensions: ['user.id'], measures: ['total'] });
    expect(sql.match(/FINAL/g)).toHaveLength(2);
    expect(sql).toContain('SUM(orders.amount)');
    expect(sql).toContain('FROM `analytics`.`users` FINAL WHERE `is_deleted` = 0) AS user');
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
    expect(client.compileDataset(Collapsing, { measures: ['rows'] })).toMatchObject({
      sql: 'SELECT COUNT(id) AS `rows` FROM collapsing FINAL WHERE collapsing.sign = ?',
      parameters: [1],
    });
  });
});
