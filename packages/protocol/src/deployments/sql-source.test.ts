import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeProtocolSqlSource } from './sql-source-analysis.js';
import { ProtocolDeploymentError } from './errors.js';
import { validateProtocolDatasetContract, validateProtocolDeploymentContract, validateProtocolDeploymentContractAtLowestVersion } from './validate.js';

interface Cases {
  accepted: { name: string; contract: { datasets: unknown[] } }[];
  rejected: { name: string; contract: unknown; code: string; path: string }[];
}

const cases = JSON.parse(readFileSync(
  new URL('../../../../specs/security-protocol/drafts/sql-sources-v1/contracts.json', import.meta.url),
  'utf8',
)) as Cases;

function failure(action: () => unknown): { code: string; path: string } {
  try {
    action();
  } catch (error) {
    if (error instanceof ProtocolDeploymentError) return { code: error.code, path: error.path };
    throw error;
  }
  throw new Error('expected a deployment error');
}

describe('RFC 0028 SQL source analysis', () => {
  it('accepts a UNION ALL activity stream and reports its tables and FINAL', () => {
    const analysis = analyzeProtocolSqlSource(
      "SELECT tenant_id, user_id, 'signup' AS step, created_at AS occurred_at FROM app.signups "
      + 'UNION ALL SELECT tenant_id, user_id, name, ts FROM app.events '
      + 'UNION ALL SELECT tenant_id, user_id, \'subscribed\', started_at FROM app.subscriptions FINAL',
      ['app.signups', 'app.events', 'app.subscriptions'],
    );
    expect(analysis).toEqual({ ok: true, tables: ['app.signups', 'app.events', 'app.subscriptions'], readsFinal: true });
  });

  it.each([
    ['quoted identifiers are unquoted before comparison', 'SELECT a FROM `app`.`events`', ['app.events']],
    ['keywords inside literals are data', "SELECT 'x; -- SETTINGS FORMAT INTO {y} $z' AS a FROM t", ['t']],
    ['FROM inside a function call is not a table', 'SELECT EXTRACT(YEAR FROM ts) AS y, substring(s FROM 2) AS z FROM t', ['t']],
    ['comma-separated tables are each references', 'SELECT 1 FROM a, b AS x, db.c', ['a', 'b', 'db.c']],
    ['joins of every kind', 'SELECT 1 FROM a LEFT ANY JOIN b ON a.x = b.x INNER JOIN (SELECT x FROM c) AS cc USING (x)', ['a', 'b', 'c']],
    ['ARRAY JOIN takes expressions', 'SELECT tag FROM a ARRAY JOIN tags AS tag, other AS o', ['a']],
    ['a CTE reads the table it shadows, then later CTEs see it', 'WITH events AS (SELECT * FROM events WHERE x), e2 AS (SELECT * FROM events) SELECT * FROM e2', ['events']],
    ['CTEs are not tables, in scope', 'WITH r AS (SELECT * FROM a) SELECT * FROM r JOIN (SELECT * FROM r) AS s ON 1', ['a']],
    ['IN reads a table, even in a function argument', 'SELECT countIf(x IN blocked) AS n FROM a', ['blocked', 'a']],
    ['a quoted column may use a refused word', 'SELECT `format`, "settings" FROM a', ['a']],
    ['quoted CTE names', 'WITH `recent` AS (SELECT x FROM app.events) SELECT x FROM `recent`', ['app.events']],
    ['FROM-first queries in a subquery', 'SELECT * FROM (FROM a SELECT x)', ['a']],
    ['lowercase keywords', 'select a from t where b in (select b from u)', ['t', 'u']],
  ])('%s', (_name, sql, tables) => {
    const analysis = analyzeProtocolSqlSource(sql, tables);
    expect(analysis).toMatchObject({ ok: true });
    expect(analysis.ok && [...analysis.tables].sort()).toEqual([...tables].sort());
  });

  it.each([
    ['', [], 'empty'],
    ['SELECT a FROM t; SELECT 1', ['t'], 'multiple-statements'],
    ['SELECT a FROM t;', ['t'], 'multiple-statements'],
    ['SELECT a FROM t -- x', ['t'], 'comment'],
    ['SELECT a FROM t /* x */', ['t'], 'comment'],
    ['SELECT a FROM t # x', ['t'], 'comment'],
    ["SELECT a FROM t WHERE b = 'what?'", ['t'], 'placeholder'],
    ['SELECT a FROM t WHERE b = {b:String}', ['t'], 'placeholder'],
    ['SELECT $$heredoc$$ FROM t', ['t'], 'placeholder'],
    ['SELECT a FROM t SETTINGS max_threads = 1', ['t'], 'forbidden-clause'],
    ['SELECT a FROM t FORMAT JSON', ['t'], 'forbidden-clause'],
    ["SELECT a FROM t INTO OUTFILE 'x'", ['t'], 'forbidden-clause'],
    ['SELECT * FROM (DESC t)', ['t'], 'unsupported-from'],
    ['SELECT 1 IN (SHOW TABLES) FROM t', ['t'], 'not-select'],
    ['SELECT * FROM t WHERE (EXPLAIN SELECT 1) = 1', ['t'], 'not-select'],
    ['DELETE FROM t WHERE 1', ['t'], 'not-select'],
    ['(SELECT 1)', [], 'not-select'],
    ["SELECT * FROM url('http://x', CSV)", [], 'table-function'],
    ["SELECT * FROM remoteSecure('h', db.t)", ['db.t'], 'table-function'],
    ["SELECT * FROM t JOIN s3('b', 'k') AS s ON 1", ['t'], 'table-function'],
    ['SELECT * FROM t, numbers(10)', ['t'], 'table-function'],
    ["SELECT * FROM merge('db', '^t')", [], 'table-function'],
    ['SELECT * FROM db.`url`(1)', [], 'table-function'],
    ["SELECT dictGetString('d', 'a', 1) FROM t", ['t'], 'forbidden-function'],
    ["SELECT joinGet('j', 'v', 1) FROM t", ['t'], 'forbidden-function'],
    ["SELECT file('/etc/passwd') FROM t", ['t'], 'forbidden-function'],
    ["SELECT getSetting('readonly') FROM t", ['t'], 'forbidden-function'],
    ['SELECT sleep(3) FROM t', ['t'], 'forbidden-function'],
    ['SELECT `dictGet`(1) FROM t', ['t'], 'forbidden-function'],
    ['SELECT * FROM system.tables', ['system.tables'], 'system-table'],
    ['SELECT * FROM INFORMATION_SCHEMA.columns', [], 'system-table'],
    ['SELECT * FROM a WHERE x IN system.users', ['a'], 'system-table'],
    ['SELECT (1 FROM t', ['t'], 'unbalanced-parentheses'],
    ['SELECT 1) FROM t', ['t'], 'unbalanced-parentheses'],
    ['SELECT * FROM (t JOIN u ON 1)', ['t', 'u'], 'unsupported-from'],
    ['SELECT * FROM a.b.c', ['a.b'], 'unsupported-from'],
    ["SELECT 'unterminated FROM t", ['t'], 'unterminated-literal'],
    ["SELECT 'it\\'s; DROP TABLE t", ['t'], 'unterminated-literal'],
    ['SELECT `open FROM t', ['t'], 'unterminated-literal'],
    ['SELECT a FROM t\u0000', ['t'], 'invalid-character'],
    ['SELECT a FROM t WHERE b = é', ['t'], 'invalid-character'],
    ['SELECT a FROM t UNION ALL SELECT a FROM secret', ['t'], 'undeclared-dependency'],
    ['SELECT a FROM t WHERE a IN secret', ['t'], 'undeclared-dependency'],
    ['SELECT a FROM events', ['app.events'], 'undeclared-dependency'],
    ['WITH r AS (SELECT 1) SELECT * FROM (SELECT * FROM r) AS x, (WITH s AS (SELECT 2) SELECT * FROM s) AS y, s', [], 'undeclared-dependency'],
    ['SELECT a FROM t', ['t', 'u'], 'unused-dependency'],
    ['WITH secret AS (SELECT * FROM secret) SELECT * FROM secret CROSS JOIN t', ['t'], 'undeclared-dependency'],
    ['WITH a AS (SELECT 1), b AS (SELECT * FROM b) SELECT * FROM a, b', [], 'undeclared-dependency'],
    ['SELECT * FROM ((SELECT 1) UNION ALL SELECT x FROM secret)', [], 'undeclared-dependency'],
    ['SELECT * FROM t WHERE x IN (FROM secret SELECT x)', ['t'], 'undeclared-dependency'],
    ['SELECT exists((FROM secret SELECT 1)) FROM t', ['t'], 'undeclared-dependency'],
    ['SELECT extract(YEAR FROM (SELECT max(ts) FROM secret)) FROM t', ['t'], 'undeclared-dependency'],
  ] as const)('refuses %j', (sql, dependencies, reason) => {
    expect(analyzeProtocolSqlSource(sql, dependencies)).toMatchObject({ ok: false, reason });
  });

  it('refuses SQL over 16 KiB', () => {
    const sql = `SELECT ${'a, '.repeat(6_000)}a FROM t`;
    expect(analyzeProtocolSqlSource(sql, ['t'])).toMatchObject({ ok: false, reason: 'too-large' });
  });
});

describe('RFC 0028 SQL sources in deployment contracts (draft fixtures)', () => {
  it.each(cases.accepted)('accepts: $name', ({ contract }) => {
    const validated = validateProtocolDeploymentContract(contract);
    expect(validated.datasets[0]!.source).toEqual(contract.datasets.map(dataset => (dataset as { source: unknown }).source)[0]);
    expect(Object.isFrozen(validated.datasets[0]!.source)).toBe(true);
    // A version 3 envelope carries the same form.
    const v3 = validateProtocolDeploymentContractAtLowestVersion({ ...contract, version: 3, datasets: contract.datasets.map(dataset => {
      const { filters, ...rest } = dataset as Record<string, unknown>;
      return { ...rest, allowedFilters: filters };
    }) });
    expect(v3.datasets[0]!.source).toEqual(validated.datasets[0]!.source);
  });

  it.each(cases.rejected)('rejects: $name', ({ contract, code, path }) => {
    expect(failure(() => validateProtocolDeploymentContract(contract))).toEqual({ code, path });
  });

  it('refuses getters in source lists without running them', () => {
    const dataset = cases.accepted[0]!.contract.datasets[0] as Record<string, unknown>;
    let calls = 0;
    const dependencies = ['app.signups', 'app.events', 'app.subscriptions'];
    Object.defineProperty(dependencies, 3, { enumerable: true, get: () => { calls += 1; return 'app.invoices'; } });
    expect(failure(() => validateProtocolDatasetContract({ ...dataset, metrics: [], source: { ...(dataset.source as object), dependencies } })))
      .toEqual({ code: 'HQ_DEPLOYMENT_UNSAFE_OBJECT', path: '$.source.dependencies[3]' });
    expect(calls).toBe(0);
  });

  it('validates a standalone dataset contract', () => {
    const dataset = cases.accepted[0]!.contract.datasets[0] as Record<string, unknown>;
    expect(validateProtocolDatasetContract({ ...dataset, metrics: [] }).source).toEqual(dataset.source);
    expect(failure(() => validateProtocolDatasetContract({ ...dataset, metrics: [], source: { ...(dataset.source as object), columns: [] } })))
      .toEqual({ code: 'HQ_DEPLOYMENT_INVALID_VALUE', path: '$.source.columns' });
    expect(failure(() => validateProtocolDatasetContract({ ...dataset, metrics: [], source: 42 })))
      .toEqual({ code: 'HQ_DEPLOYMENT_TYPE', path: '$.source' });
  });
});
