import { validateProtocolDeploymentContractAnyVersion } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import {
  belongsTo,
  createDatasetClient,
  dataset,
  dimension,
  measure,
} from './index.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { datasetCacheKey, resolveProtocolCacheKeySettings } from './cache/protocol-cache-keys.js';
import { createPortableSemanticExecutor } from './portable-executor.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';
import type { DatasetConfig, DatasetSqlSource } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

// RFC 0028: the activity stream cross-dataset funnels read. Subscriptions is a
// ReplacingMergeTree, so its branch reads FINAL and drops deleted rows itself.
const ACTIVITY_SQL = [
  "SELECT tenant_id, user_id, 'signup' AS step, created_at AS occurred_at FROM app.signups",
  'SELECT tenant_id, user_id, name AS step, `timestamp` AS occurred_at FROM app.events',
  "SELECT tenant_id, user_id, 'subscribed' AS step, started_at AS occurred_at FROM app.subscriptions FINAL WHERE is_deleted = 0",
  "SELECT tenant_id, user_id, 'paid' AS step, paid_at AS occurred_at FROM app.invoices",
].join('\nUNION ALL\n');

const ACTIVITY_SOURCE: DatasetSqlSource = {
  sql: ACTIVITY_SQL,
  dependencies: ['app.signups', 'app.events', 'app.subscriptions', 'app.invoices'],
  columns: { tenant_id: 'string', user_id: 'string', step: 'string', occurred_at: 'timestamp' },
};

const DERIVED_TABLE = `(SELECT tenant_id, user_id, step, occurred_at FROM (${ACTIVITY_SQL})) AS activity`;

const Users = dataset('users', {
  source: 'app.users',
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.string(), plan: dimension.string() },
});

const activityConfig = {
  source: ACTIVITY_SOURCE,
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  dimensions: {
    user_id: dimension.string(),
    step: dimension.string(),
    occurred_at: dimension.timestamp(),
  },
  measures: {
    users: measure.countDistinct('user_id'),
    events: measure.count('user_id'),
    trailingEvents: measure.trailing('events', { amount: 7, unit: 'day' }),
  },
  relationships: {
    user: belongsTo(() => Users, { from: 'user_id', to: 'id' }),
  },
} satisfies DatasetConfig<any, any, any>;

const Activity = dataset('activity', activityConfig);

const TENANT = { runtime: { tenant: { id: 'acme' } } } as const;

function recordingBuilder() {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const settings: unknown[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(sql: string, values: unknown[] = [], options?: { clickhouseSettings?: unknown }) {
        calls.push(sql);
        params.push(values);
        settings.push(options?.clickhouseSettings);
        return [] as T[];
      },
    },
  });
  return { calls, params, settings, db };
}

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });

/** Defines `activity` with part of the config replaced. */
function define(overrides: Record<string, unknown>) {
  return () => dataset('activity', { ...activityConfig, ...overrides } as never);
}

function withSql(sql: string, dependencies: readonly string[] = ['app.events']) {
  return define({ source: { ...ACTIVITY_SOURCE, sql, dependencies } });
}

describe('SQL-sourced datasets (RFC 0028)', () => {
  describe('definition', () => {
    it('aliases the derived table as the dataset and records what the checker found', () => {
      expect(Activity.source).toBe('activity');
      expect(Activity.sqlSource).toEqual({ ...ACTIVITY_SOURCE, readsFinal: true });
      expect(Object.isFrozen(Activity.sqlSource)).toBe(true);
    });

    const SELECT = 'SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events';
    it.each([
      ['a second statement', withSql(`${SELECT}; DROP TABLE app.events`), 'contains ";"'],
      ['a trailing semicolon', withSql(`${SELECT};`), 'contains ";"'],
      ['a line comment', withSql(`${SELECT} -- note`), 'contains a comment'],
      ['a block comment', withSql(`${SELECT} /* note */`), 'contains a comment'],
      ['a placeholder', withSql(`${SELECT} WHERE name = ?`), 'contains "?"'],
      ['a server parameter', withSql(`${SELECT} WHERE name = {name:String}`), 'contains "{"'],
      ['a heredoc', withSql(`${SELECT} WHERE name = $$x$$`), 'contains "$"'],
      ['SETTINGS', withSql(`${SELECT} SETTINGS max_threads = 1`), 'uses SETTINGS'],
      ['FORMAT', withSql(`${SELECT} FORMAT JSON`), 'uses FORMAT'],
      ['INTO OUTFILE', withSql(`${SELECT} INTO OUTFILE 'x.csv'`), 'uses INTO'],
      ['a statement other than SELECT', withSql('INSERT INTO app.events SELECT * FROM app.events'), 'must be a single SELECT'],
      ['url()', withSql("SELECT * FROM url('https://example.com/x.csv', CSV)"), 'table function url()'],
      ['remote()', withSql('SELECT * FROM remote(\'other:9000\', app.events)'), 'table function remote()'],
      ['file() in a join', withSql(`${SELECT} JOIN file('/etc/passwd') AS f ON 1`), 'table function file()'],
      ['s3() after a comma', withSql(`${SELECT}, s3('bucket/key')`), 'table function s3()'],
      ['numbers()', withSql('SELECT * FROM numbers(10)'), 'table function numbers()'],
      ['dictGet()', withSql("SELECT dictGet('d', 'a', user_id) AS tenant_id FROM app.events"), 'calls dictGet()'],
      ['sleep()', withSql(`${SELECT} WHERE sleep(1) = 0`), 'calls sleep()'],
      ['a system table', withSql('SELECT * FROM system.tables', ['system.tables']), 'reads system.tables'],
      ['an unterminated literal', withSql(`${SELECT} WHERE name = 'x`), 'unterminated'],
      ['an undeclared table', withSql(`${SELECT} UNION ALL SELECT tenant_id, user_id, name, ts FROM app.secrets`), 'reads "app.secrets"'],
      ['an undeclared IN table', withSql(`${SELECT} WHERE user_id IN app.blocked`), 'reads "app.blocked"'],
      ['an unused dependency', withSql(SELECT, ['app.events', 'app.signups']), 'never reads declared dependency "app.signups"'],
    ])('refuses %s', (_name, build, message) => {
      expect(build).toThrow(message);
    });

    it.each([
      ['rowResolution', define({ rowResolution: { kind: 'final' } }), 'rowResolution and final apply to a table'],
      ['final', define({ final: true }), 'rowResolution and final apply to a table'],
      ['an unknown source key', define({ source: { ...ACTIVITY_SOURCE, params: {} } }), 'unknown key "params"'],
      ['no dependencies', define({ source: { ...ACTIVITY_SOURCE, dependencies: [] } }), 'must list every table'],
      ['no columns', define({ source: { ...ACTIVITY_SOURCE, columns: {} } }), 'must declare the columns'],
      ['an unknown column type', define({ source: { ...ACTIVITY_SOURCE, columns: { ...ACTIVITY_SOURCE.columns, step: 'text' } } }), 'has type "text"'],
      ['an undeclared dimension column', define({ dimensions: { ...activityConfig.dimensions, name: dimension.string() } }), 'dimension "name" column "name" is not a column'],
      ['a dimension of another type', define({ dimensions: { ...activityConfig.dimensions, step: dimension.number() } }), 'dimension "step" is number, but source column "step" is declared string'],
      ['an undeclared tenant key', define({ tenantKey: 'org_id' }), 'tenantKey "org_id" is not a column'],
      ['an undeclared measure field', define({ measures: { revenue: measure.sum('amount') } }), 'measure "revenue" field "amount" is not a column'],
      ['an undeclared filter field', define({ filters: { org: { field: 'org_id' } } }), 'filter "org" field "org_id" is not a column'],
      ['an undeclared relationship key', define({ relationships: { user: belongsTo(() => Users, { from: 'account_id', to: 'id' }) } }), 'relationship "user" key "account_id"'],
    ])('refuses %s', (_name, build, message) => {
      expect(build).toThrow(message);
    });

    it('accepts SQL dimensions over declared columns, qualified or bare', () => {
      expect(() => dataset('activity', {
        ...activityConfig,
        dimensions: {
          ...activityConfig.dimensions,
          funnelStep: dimension.string({ sql: "if(activity.step = 'paid', 'won', step)", dependencies: ['activity.step'] }),
        },
      })).not.toThrow();
      expect(define({
        dimensions: { ...activityConfig.dimensions, hidden: dimension.string({ sql: 'upper(name)', dependencies: ['name'] }) },
      })).toThrow('dimension "hidden" dependency "name" is not a column');
    });
  });

  describe('query planning', () => {
    it('reads the derived table with tenant scoping on the outer query and the FINAL pin', async () => {
      const sql = client.toSQL(Activity, { dimensions: ['step'], measures: ['users'] }, TENANT);
      expect(sql).toContain(`FROM ${DERIVED_TABLE} WHERE activity.tenant_id = ?`);
      const { calls, params, settings, db } = recordingBuilder();
      await createDatasetClient({ queryBuilder: db }).execute(Activity, { dimensions: ['step'], measures: ['users'] }, TENANT);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`FROM ${DERIVED_TABLE}`);
      expect(params[0]).toEqual(['acme']);
      expect(settings[0]).toMatchObject({ optimize_move_to_prewhere_if_final: 0 });
    });

    it('omits the FINAL pin when the SQL reads no FINAL', async () => {
      const Plain = dataset('plain_activity', {
        ...activityConfig,
        source: { ...ACTIVITY_SOURCE, sql: 'SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events', dependencies: ['app.events'] },
      });
      const { calls, settings, db } = recordingBuilder();
      await createDatasetClient({ queryBuilder: db }).execute(Plain, { dimensions: ['step'], measures: ['users'] }, TENANT);
      expect(calls[0]).toContain('FROM (SELECT tenant_id, user_id, step, occurred_at FROM (SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events)) AS plain_activity');
      expect(JSON.stringify(settings[0] ?? {})).not.toContain('optimize_move_to_prewhere_if_final');
    });

    it('applies caller filters and the time axis to the derived table', () => {
      const sql = client.toSQL(Activity, {
        dimensions: ['step'],
        measures: ['users'],
        filters: [{ field: 'step', operator: 'eq', value: 'paid' }],
        by: 'week',
      }, TENANT);
      expect(sql).toContain(`FROM ${DERIVED_TABLE}`);
      expect(sql).toContain('activity.step = ?');
      expect(sql).toMatch(/toStartOfWeek\(toDateTime64\(activity\.occurred_at/);
    });

    it('joins relationship targets onto the alias', () => {
      const sql = client.toSQL(Activity, { dimensions: ['user.plan'], measures: ['users'] }, TENANT);
      expect(sql).toContain(`FROM ${DERIVED_TABLE}`);
      expect(sql).toContain('LEFT ANY JOIN');
      expect(sql).toContain('activity.user_id');
      expect(sql).toContain('`app`.`users`');
    });

    it('carries the derived table and the FINAL pin into raw-SQL time measures', async () => {
      const { calls, params, db } = recordingBuilder();
      const recording = createDatasetClient({ queryBuilder: db });
      await recording.execute(Activity, {
        measures: ['trailingEvents'],
        by: 'day',
        filters: [{ field: 'occurred_at', operator: 'between', value: ['2026-01-01', '2026-01-31'] }],
      }, TENANT);
      expect(calls.length).toBeGreaterThan(0);
      for (const [index, sql] of calls.entries()) {
        expect(sql).toContain(DERIVED_TABLE);
        expect(sql).toContain('activity.tenant_id = ?');
        expect(params[index]).toContain('acme');
        expect(sql).toContain('SETTINGS optimize_move_to_prewhere_if_final = 0');
      }
    });

    it('executes the derived table through the query builder', async () => {
      const { calls, db } = recordingBuilder();
      await createDatasetClient({ queryBuilder: db }).execute(Activity, { dimensions: ['step'], measures: ['users'] }, TENANT);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`FROM ${DERIVED_TABLE}`);
    });

    it('refuses a SQL-sourced dataset as a relationship target', () => {
      const Accounts = dataset('accounts', {
        source: 'app.accounts',
        dimensions: { user_id: dimension.string() },
        measures: { accounts: measure.count('user_id') },
        relationships: { activity: belongsTo(() => Activity, { from: 'user_id', to: 'user_id' }) },
      });
      expect(() => client.toSQL(Accounts, { dimensions: ['activity.step'], measures: ['accounts'] })).toThrow(
        'SQL-sourced datasets can\'t be relationship targets yet',
      );
    });

    it('refuses semantic backends, which read sources by table name', async () => {
      const backend = createDatasetClient({ backend: createInMemoryBackend({ activity: [] }) });
      await expect(async () => backend.execute(Activity, { measures: ['users'] }, TENANT)).rejects.toThrow(
        'Dataset "activity" reads a SQL source, which the semantic-backend execution path does not support',
      );
    });

    it('refuses SQL dialects other than ClickHouse', () => {
      const real = createQueryBuilder({ host: 'http://localhost:8123' });
      const other = {
        table: real.table.bind(real),
        rawQuery: real.rawQuery.bind(real),
        datasetSqlDialect: { ...clickhouseDatasetSqlDialect, name: 'other' },
      } as unknown as QueryBuilderFactoryLike;
      expect(() => createDatasetClient({ queryBuilder: other }).toSQL(Activity, { measures: ['users'] }, TENANT)).toThrow(
        'the "other" datasets dialect cannot run',
      );
    });
  });

  describe('deployment contract', () => {
    const deployment = () => buildProtocolDeploymentContract([Activity, Users]);
    const published = () => deployment().datasets.find(item => item.name === 'activity')!;

    it('publishes the contract form and validates under the protocol', () => {
      expect(published().source).toEqual({
        kind: 'sql',
        dialect: 'clickhouse',
        sql: ACTIVITY_SQL,
        dependencies: ['app.signups', 'app.events', 'app.subscriptions', 'app.invoices'],
        columns: [
          { name: 'tenant_id', type: 'string' },
          { name: 'user_id', type: 'string' },
          { name: 'step', type: 'string' },
          { name: 'occurred_at', type: 'timestamp' },
        ],
      });
      expect(() => validateProtocolDeploymentContractAnyVersion(JSON.parse(JSON.stringify(deployment())))).not.toThrow();
    });

    it('rehydrates to a dataset that plans identical SQL', () => {
      const hydrated = rehydrateProtocolDatasets(deployment().datasets);
      expect(hydrated.activity!.sqlSource).toEqual(Activity.sqlSource);
      const query = { dimensions: ['step', 'user.plan'], measures: ['users'] };
      expect(client.toSQL(hydrated.activity!, query, TENANT)).toBe(client.toSQL(Activity, query, TENANT));
    });

    it('runs through the portable executor from the contract alone', async () => {
      const { calls, params, db } = recordingBuilder();
      const contract = buildProtocolDeploymentContract([Activity, Users], {
        endpoints: {
          activity: {
            access: { kind: 'authenticated', roles: [], scopes: [] },
            tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
          },
        },
      } as never);
      const execute = createPortableSemanticExecutor({ queryBuilder: db });
      await execute({
        deployment: contract,
        dataset: contract.datasets.find(item => item.name === 'activity')!,
        operation: { kind: 'dataset', dataset: 'activity', dimensions: ['step'], measures: ['users'] } as never,
        tenant: 'acme',
        budget: { maxRows: 100 },
        activationRevision: 'a'.repeat(64),
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`FROM ${DERIVED_TABLE} WHERE activity.tenant_id = ?`);
      expect(params[0]).toEqual(['acme']);
    });

    it('refuses publishing a relationship that targets a SQL-sourced dataset', () => {
      const Accounts = dataset('accounts', {
        source: 'app.accounts',
        dimensions: { user_id: dimension.string() },
        relationships: { activity: belongsTo(() => Activity, { from: 'user_id', to: 'user_id' }) },
      });
      expect(() => buildProtocolDeploymentContract([Accounts, Activity, Users])).toThrow('HQ_DEPLOYMENT_INVALID_REFERENCE');
    });
  });

  describe('cache identity', () => {
    const variant = (sql: string) => dataset('activity', {
      ...activityConfig,
      source: { ...ACTIVITY_SOURCE, sql: `${sql}`, dependencies: ['app.events'] },
    });
    const a = variant('SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events');
    const b = variant("SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events WHERE name != 'test'");
    const query = { dimensions: ['step'], measures: ['users'], limit: 10 };

    it('keys the readable signature on the SQL hash', () => {
      const signature = buildDatasetQuerySignature(a, query, TENANT);
      expect(signature).toMatch(/"sourceSha256":"[0-9a-f]{64}"/);
      expect(buildDatasetQuerySignature(b, query, TENANT)).not.toBe(signature);
      expect(buildDatasetQuerySignature(Users, { dimensions: ['plan'] }, TENANT)).not.toContain('sourceSha256');
    });

    it('separates result-cache keys when the SQL changes', () => {
      const settings = resolveProtocolCacheKeySettings({ secret: new Uint8Array(32).fill(7) }, false);
      const key = (ds: typeof a) => datasetCacheKey(settings, ds, query, TENANT, undefined);
      expect(key(a)).toBeDefined();
      expect(key(a)).toBe(key(variant('SELECT tenant_id, user_id, name AS step, ts AS occurred_at FROM app.events')));
      expect(key(b)).not.toBe(key(a));
    });
  });
});
