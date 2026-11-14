/**
 * `schema inspect`, `onboard analyze` and `onboard check` against a real
 * ClickHouse, with the published engine installed in a scratch project.
 * Integration-only (`pnpm --filter @hypequery/cli test:integration`); skipped
 * unless both are given:
 *
 *   docker compose -f examples/_seed/docker-compose.yml up -d --wait && pnpm seed
 *   CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USERNAME=default \
 *   CLICKHOUSE_PASSWORD=hypequery CLICKHOUSE_DATABASE=hypequery_examples \
 *   HYPEQUERY_ONBOARD_ENGINE=@hypequery/onboard-engine@^0.1.0 \
 *   pnpm --filter @hypequery/cli build && pnpm --filter @hypequery/cli test:integration
 *
 * HYPEQUERY_ONBOARD_ENGINE is anything `npm install` accepts, such as a
 * tarball from `npm pack`. The examples seed (tenants, users, events) is the
 * data. The CLICKHOUSE_* user must be able to create a user: one without the
 * query_log grant is created and dropped to prove history degrades to a warning.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const engine = process.env.HYPEQUERY_ONBOARD_ENGINE;
const url = process.env.CLICKHOUSE_URL;
const enabled = Boolean(engine && url);
const CLI = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const DATASETS = fileURLToPath(new URL('../../../datasets/dist/index.js', import.meta.url));
const restricted = { user: `hq_onboard_it_${process.pid}`, password: `pw-${Date.now()}` };

async function admin(sql: string) {
  const response = await fetch(url!, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.CLICKHOUSE_USERNAME ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`).toString('base64')}` },
    body: sql,
  });
  if (!response.ok) throw new Error(await response.text());
}

async function cli(cwd: string, args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, HYPEQUERY_TELEMETRY_DISABLED: '1', CI: '1', ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

describe.skipIf(!enabled)('onboarding commands against ClickHouse', () => {
  let project: string;

  beforeAll(async () => {
    project = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-onboard-it-')));
    await writeFile(path.join(project, 'package.json'), '{"name":"onboard-it","private":true,"type":"module"}');
    await run('npm', ['install', '--no-audit', '--no-fund', '-D', engine!], { cwd: project });
    await admin(`CREATE USER IF NOT EXISTS ${restricted.user} IDENTIFIED BY '${restricted.password}' SETTINGS readonly = 2`);
    for (const target of [`${process.env.CLICKHOUSE_DATABASE ?? 'default'}.*`, 'system.tables', 'system.columns', 'system.parts']) {
      await admin(`GRANT SELECT ON ${target} TO ${restricted.user}`);
    }
  });

  afterAll(async () => {
    await admin(`DROP USER IF EXISTS ${restricted.user}`).catch(() => undefined);
    if (project) await rm(project, { recursive: true, force: true });
  });

  it('schema inspect lists the tables with engine metadata', async () => {
    const result = await cli(project, ['schema', 'inspect', '--json']);
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.engine).toMatchObject({ package: '@hypequery/onboard-engine', from: 'project' });
    const tables = report.schema.tables.map((table: { name: string }) => table.name);
    expect(tables).toEqual(expect.arrayContaining(['tenants', 'users', 'events']));
    expect(report.schema.tables.find((table: { name: string }) => table.name === 'events').engineMetadata).toMatchObject({ family: 'MergeTree' });
  });

  it('onboard analyze proposes joins and asks about tenant columns', async () => {
    const result = await cli(project, ['onboard', 'analyze', '--json']);
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.joinCandidates.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ child: { table: 'users', column: 'tenant_id' }, parent: { table: 'tenants', column: 'tenant_id' }, outcome: 'proposed' }),
    ]));
    expect(report.tenantKeyCandidates.candidates).toEqual(expect.arrayContaining([{ table: 'users', column: 'tenant_id' }]));
    expect(JSON.stringify(report)).not.toContain('"proof"');
  });

  it('onboard analyze succeeds with a warning when the user cannot read query history', async () => {
    const result = await cli(project, ['onboard', 'analyze', '--json'], {
      CLICKHOUSE_USERNAME: restricted.user,
      CLICKHOUSE_PASSWORD: restricted.password,
    });
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.queryHistory.status).toBe('skipped');
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QUERY_HISTORY_UNAVAILABLE', hint: expect.stringContaining('system.query_log') }),
    ]));
  });

  it('onboard check measures declared joins and fails on a bad one', async () => {
    const { publishToCloud, dataset, dimension, measure, belongsTo } = await import(DATASETS);
    const Tenants = dataset('tenants', { source: 'tenants', dimensions: { tenant_id: dimension.number(), plan: dimension.string() }, measures: { tenants: measure.count('tenant_id') } });
    const Users = dataset('users', {
      source: 'users',
      dimensions: { tenant_id: dimension.number(), role: dimension.string() },
      measures: { users: measure.count('user_id') },
      relationships: { tenant: belongsTo(() => Tenants, { from: 'tenant_id', to: 'tenant_id' }) },
    });
    const file = path.join(project, 'deployment.json');
    await writeFile(file, JSON.stringify(publishToCloud({ datasets: { Users, Tenants }, access: { roles: [], scopes: [] } })));

    const passing = await cli(project, ['onboard', 'check', file, '--json']);
    expect(passing.code, passing.stderr).toBe(0);
    const report = JSON.parse(passing.stdout);
    expect(report.joinChecks).toEqual([expect.objectContaining({ relationship: 'users.tenant', status: 'measured', problem: null })]);

    const failing = await cli(project, ['onboard', 'check', file, '--json', '--join', 'users.tenant_id=users.user_id']);
    expect(failing.code).toBe(1);
    expect(JSON.parse(failing.stdout).error).toMatchObject({ code: 'ONBOARD_CHECK_FAILED', issues: [expect.objectContaining({ path: 'joins/users.tenant_id=users.user_id' })] });
  });
});
