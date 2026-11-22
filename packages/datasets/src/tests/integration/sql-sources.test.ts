import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { measure } from '../../measure.js';
import { createDatasetClient } from '../../executor.js';
import { belongsTo } from '../../relationships.js';
import { buildProtocolDeploymentContract } from '../../protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from '../../protocol-rehydrate.js';
import { TEST_CONNECTION_CONFIG, runSql } from '../../../../../testing/clickhouse/harness.mjs';

// RFC 0028 on a live server: a UNION ALL activity stream over four tables,
// with a ReplacingMergeTree branch read with FINAL and unmerged versions.
const connection = {
  host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database,
};
// Settings that would let a filter match an old version unless the pin applies.
const db = createQueryBuilder({ ...connection, clickhouseSettings: { optimize_move_to_prewhere: 1, optimize_move_to_prewhere_if_final: 1 } });
const client = createDatasetClient({ queryBuilder: db });
const tables = ['sql_src_signups', 'sql_src_events', 'sql_src_subscriptions', 'sql_src_invoices', 'sql_src_users'];
const tenant = (id: string) => ({ runtime: { tenant: { id } } });

const SQL = [
  "SELECT tenant_id, user_id, 'signup' AS step, created_at AS occurred_at FROM sql_src_signups",
  'SELECT tenant_id, user_id, name AS step, `timestamp` AS occurred_at FROM sql_src_events',
  "SELECT tenant_id, user_id, 'subscribed' AS step, started_at AS occurred_at FROM sql_src_subscriptions FINAL WHERE is_deleted = 0",
  "SELECT tenant_id, user_id, 'paid' AS step, paid_at AS occurred_at FROM sql_src_invoices",
].join('\nUNION ALL\n');

const Users = dataset('users', {
  source: 'sql_src_users',
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.string(), plan: dimension.string() },
});

const Activity = dataset('activity', {
  source: {
    sql: SQL,
    dependencies: ['sql_src_signups', 'sql_src_events', 'sql_src_subscriptions', 'sql_src_invoices'],
    columns: { tenant_id: 'string', user_id: 'string', step: 'string', occurred_at: 'timestamp' },
  },
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  dimensions: { user_id: dimension.string(), step: dimension.string(), occurred_at: dimension.timestamp() },
  measures: {
    users: measure.countDistinct('user_id'),
    events: measure.count('user_id'),
    runningEvents: measure.cumulative('events'),
  },
  relationships: { user: belongsTo(() => Users, { from: 'user_id', to: 'id' }) },
});

const numeric = (rows: readonly Record<string, unknown>[]) => rows.map(row => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value]),
));

describe('SQL-sourced datasets on ClickHouse (RFC 0028)', () => {
  beforeAll(async () => {
    for (const table of tables) await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql('DROP USER IF EXISTS sql_src_reader');
    await runSql('CREATE USER sql_src_reader IDENTIFIED WITH no_password SETTINGS readonly = 2');
    await runSql(`GRANT SELECT ON ${TEST_CONNECTION_CONFIG.database}.* TO sql_src_reader`);
    await runSql('CREATE TABLE sql_src_signups (tenant_id String, user_id String, created_at DateTime) ENGINE = MergeTree ORDER BY user_id');
    await runSql('CREATE TABLE sql_src_events (tenant_id String, user_id String, name String, `timestamp` DateTime) ENGINE = MergeTree ORDER BY user_id');
    await runSql('CREATE TABLE sql_src_subscriptions (tenant_id String, user_id String, started_at DateTime, version UInt64, is_deleted UInt8) ENGINE = ReplacingMergeTree(version) ORDER BY (tenant_id, user_id)');
    await runSql('SYSTEM STOP MERGES sql_src_subscriptions');
    await runSql('CREATE TABLE sql_src_invoices (tenant_id String, user_id String, paid_at DateTime) ENGINE = MergeTree ORDER BY user_id');
    await runSql('CREATE TABLE sql_src_users (tenant_id String, id String, plan String) ENGINE = MergeTree ORDER BY id');
    // User ids repeat across tenants: tenant isolation must come from the tenant column.
    await runSql(`INSERT INTO sql_src_signups VALUES
      ('a','u1','2026-03-01 10:00:00'), ('a','u2','2026-03-01 11:00:00'), ('a','u3','2026-03-02 09:00:00'), ('b','u1','2026-03-01 12:00:00')`);
    await runSql(`INSERT INTO sql_src_events VALUES
      ('a','u1','viewed','2026-03-01 10:05:00'), ('a','u1','viewed','2026-03-01 10:06:00'), ('a','u2','viewed','2026-03-01 11:05:00'), ('b','u1','viewed','2026-03-01 12:05:00')`);
    // Two versions of u1's subscription; u2's latest version is deleted.
    await runSql(`INSERT INTO sql_src_subscriptions VALUES ('a','u1','2026-03-01 10:10:00',1,0), ('a','u2','2026-03-01 11:10:00',1,0), ('b','u1','2026-03-01 12:10:00',1,0)`);
    await runSql(`INSERT INTO sql_src_subscriptions VALUES ('a','u1','2026-03-02 10:10:00',2,0), ('a','u2','2026-03-02 11:10:00',2,1)`);
    await runSql(`INSERT INTO sql_src_invoices VALUES ('a','u1','2026-03-03 10:00:00'), ('b','u1','2026-03-03 12:00:00')`);
    await runSql(`INSERT INTO sql_src_users VALUES ('a','u1','pro'), ('a','u2','free'), ('a','u3','free'), ('b','u1','enterprise')`);
  });

  afterAll(async () => {
    for (const table of tables) await runSql(`DROP TABLE IF EXISTS ${table}`);
    await runSql('DROP USER IF EXISTS sql_src_reader');
  });

  it('matches independent per-step totals for one tenant, with FINAL resolving versions', async () => {
    const expected = await db.rawQuery(
      `SELECT step, uniqExact(user_id) AS users, count() AS events FROM (${SQL}) WHERE tenant_id = 'a' GROUP BY step ORDER BY step SETTINGS optimize_move_to_prewhere_if_final = 0`,
    );
    const actual = await client.execute(Activity, {
      dimensions: ['step'], measures: ['users', 'events'], orderBy: [{ field: 'step', direction: 'asc' }],
    }, tenant('a'));
    expect(numeric(actual.data)).toEqual(numeric(expected));
    // One current subscription (u1, latest version); u2's is deleted.
    expect(numeric(actual.data).find(row => row.step === 'subscribed')).toEqual({ step: 'subscribed', users: 1, events: 1 });
  });

  it('keeps tenants apart although their user ids collide', async () => {
    const b = await client.execute(Activity, { dimensions: ['step'], measures: ['events'], orderBy: [{ field: 'step', direction: 'asc' }] }, tenant('b'));
    expect(numeric(b.data)).toEqual([
      { step: 'paid', events: 1 }, { step: 'signup', events: 1 }, { step: 'subscribed', events: 1 }, { step: 'viewed', events: 1 },
    ]);
  });

  it('joins a table dataset onto the derived table', async () => {
    const result = await client.execute(Activity, {
      dimensions: ['user.plan'], measures: ['users'], orderBy: [{ field: 'user.plan', direction: 'asc' }],
    }, tenant('a'));
    expect(numeric(result.data)).toEqual([{ 'user.plan': 'free', users: 2 }, { 'user.plan': 'pro', users: 1 }]);
  });

  it('runs raw-SQL time measures over the derived table', async () => {
    const result = await client.execute(Activity, {
      measures: ['runningEvents'],
      by: 'day',
      filters: [{ field: 'occurred_at', operator: 'between', value: ['2026-03-01T00:00:00Z', '2026-03-03T23:59:59Z'] }],
    }, tenant('a'));
    expect(result.data.map(row => Number(row.runningEvents))).toEqual([5, 7, 8]);
  });

  it('runs the rehydrated contract identically, as a readonly user', async () => {
    const hydrated = rehydrateProtocolDatasets(buildProtocolDeploymentContract([Activity, Users]).datasets);
    const reader = createDatasetClient({ queryBuilder: createQueryBuilder({ ...connection, username: 'sql_src_reader', password: '' }) });
    const query = { dimensions: ['step'], measures: ['users'], orderBy: [{ field: 'step', direction: 'asc' as const }] };
    const expected = await client.execute(Activity, query, tenant('a'));
    expect(numeric((await reader.execute(hydrated.activity!, query, tenant('a'))).data)).toEqual(numeric(expected.data));
  });
});
