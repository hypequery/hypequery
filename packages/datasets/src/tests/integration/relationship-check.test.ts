import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { checkRelationships } from '../../relationship-check.js';
import { belongsTo } from '../../relationships.js';
import {
  TEST_CONNECTION_CONFIG,
  insertRows,
  runSql,
} from '../../../../../testing/clickhouse/harness.mjs';

const table = 'relationship_check_targets';
const qualifiedTable = `${TEST_CONNECTION_CONFIG.database}.${table}`;

const Targets = dataset('relationshipCheckTargets', {
  source: table,
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.number() },
});

const Sources = dataset('relationshipCheckSources', {
  source: 'orders',
  dimensions: { id: dimension.number() },
  relationships: {
    target: belongsTo(() => Targets, { from: 'user_id', to: 'id' }),
  },
});

const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database,
});

describe('checkRelationships against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${qualifiedTable}`, { includeDatabase: false });
    await runSql(
      `CREATE TABLE ${qualifiedTable} (
        id Nullable(UInt64),
        tenant_id String
      ) ENGINE = MergeTree() ORDER BY tenant_id`,
      { includeDatabase: false },
    );
    await insertRows(table, [
      { id: 1, tenant_id: 'a' },
      { id: 2, tenant_id: 'a' },
      { id: null, tenant_id: 'a' },
      { id: null, tenant_id: 'a' },
      { id: 1, tenant_id: 'b' },
      { id: 3, tenant_id: 'b' },
      { id: 3, tenant_id: 'b' },
    ]);
  });

  afterAll(async () => {
    await runSql(`DROP TABLE IF EXISTS ${qualifiedTable}`, { includeDatabase: false });
  });

  it('ignores NULL keys and accepts unique keys in one tenant', async () => {
    const result = await checkRelationships(Sources, {
      queryBuilder: db,
      context: { runtime: { tenant: { id: 'a' } } },
    });
    expect(result).toEqual({ ok: true, checked: ['target'], issues: [] });
  });

  it('reports duplicate target keys in the selected tenant', async () => {
    const result = await checkRelationships(Sources, {
      queryBuilder: db,
      context: { runtime: { tenant: { id: 'b' } } },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        relationship: 'target',
        rows: 3,
        distinctKeys: 2,
      }),
    ]);
  });

  it('checks all visible tenants when cross-tenant access is requested', async () => {
    const result = await checkRelationships(Sources, {
      queryBuilder: db,
      context: { runtime: { tenant: { scope: 'all' } } },
    });
    expect(result.issues).toEqual([
      expect.objectContaining({ rows: 5, distinctKeys: 3 }),
    ]);
  });
});
