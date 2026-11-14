import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableJsonOutput, enableJsonOutput } from '../utils/machine-output.js';
import type { DiscoveredSchema, OnboardEngine, OnboardEngineModules } from '../utils/onboard/engine-types.js';
import { onboardCommand, schemaCommand } from './onboard.js';

vi.mock('../utils/logger.js', () => ({
  logger: { header: vi.fn(), success: vi.fn(), info: vi.fn(), indent: vi.fn(), warn: vi.fn(), error: vi.fn(), newline: vi.fn() },
}));

class ClickHouseConnectionError extends Error {
  constructor(message: string, readonly exceptionCode?: number, readonly kind: 'connection' | 'access' | 'query' = 'connection') {
    super(message);
    this.name = 'ClickHouseConnectionError';
  }
}

const input = { host: 'http://localhost:8123', database: 'shop', username: 'reader', password: 'pw' };

const SCHEMA: DiscoveredSchema = {
  database: 'shop',
  truncated: false,
  tables: [
    {
      name: 'orders', comment: '', supported: true, rows: 10, engine: 'MergeTree',
      columns: [
        { name: 'id', type: 'UInt64', comment: '', supported: true },
        { name: 'tenant_id', type: 'String', comment: '', supported: true },
        { name: 'customer_id', type: 'UInt64', comment: '', supported: true },
        { name: 'email', type: 'String', comment: '', supported: true, stats: { distinct: 3, samples: ['a@x.com'] } },
      ],
    },
    { name: 'customers', comment: '', supported: true, rows: 3, engine: 'MergeTree', columns: [{ name: 'id', type: 'UInt64', comment: '', supported: true }] },
  ],
  analysis: {
    findings: [{ id: 'statuses:orders', table: 'orders', kind: 'statuses', finding: 'orders.status has 3 values.', question: 'Which statuses count as revenue?', askBeforeDraft: true, proof: { sql: 'SELECT secret' } }],
    queries: 1, elapsedMs: 1, checkedTables: ['orders'], skippedTables: [],
  },
};

/** A fake engine: canned results, recording what the CLI asked for. */
function fakeEngine(overrides: Partial<{ [K in keyof OnboardEngineModules]: Partial<OnboardEngineModules[K]> }> = {}) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown[]) => { (calls[name] ??= []).push(args); };
  const modules = {
    'clickhouse-query': { ClickHouseConnectionError },
    'access-profile': {
      ACCESS_PROFILE_QUERY: 'SELECT profile',
      parseAccessProfile: (body: string) => (body === 'profile' ? { readonly: 2 } : null),
      readonlyAccessReport: () => ({ readonly: 2, risks: [], profileFix: null }),
      checkQueryBounds: () => ({ kind: 'own' }),
    },
    'connection-capabilities': {
      checkConnectionCapabilities: async (...args: unknown[]) => {
        record('capabilities', args);
        return [
          { id: 'tables', target: 'system.tables', status: 'available', disabledChecks: [], fix: '' },
          { id: 'query-log', target: 'system.query_log', status: 'missing', disabledChecks: ['history'], fix: 'GRANT SELECT ON system.query_log TO `reader`;' },
        ];
      },
    },
    introspection: { discoverSchema: async () => SCHEMA },
    'grain-check-runner': {
      verifyGrainChecks: async (_i: unknown, _q: unknown, schema: DiscoveredSchema, tables: string[]) => {
        record('grain', [tables]);
        return { ...schema, grainChecks: [{ id: 'G2', table: 'orders', status: 'finding', summary: 'Duplicate ids.', proof: { sql: 'x' }, examples: { columns: ['id'], rows: [['1']] } }] };
      },
    },
    'join-candidate-runner': {
      verifyJoinCandidates: async () => ({
        candidates: [{ id: 'j1', child: { table: 'orders', column: 'customer_id' }, parent: { table: 'customers', column: 'id' }, outcome: 'proposed', reason: 'Strong containment.', proof: { sql: 'x' } }],
        omitted: 0,
      }),
      boundedJoinQuery: async () => async () => '{}',
    },
    'join-check': {
      checkJoin: async (_schema: unknown, request: { child: { column: string } }) => ({ ...request, status: 'measured', reason: '', unique: request.child.column === 'customer_id', proof: { sql: 'x' } }),
      joinCheckSummary: (check: { child: { column: string } }) => `summary ${check.child.column}`,
      joinProblem: (check?: { unique?: boolean }) => (check?.unique ? null : 'Not unique.'),
    },
    'query-history': {
      inspectQueryHistory: async (...args: unknown[]) => {
        record('history', args);
        return { status: 'skipped', reason: 'Query history was unavailable.' };
      },
      queryHistoryContext: () => ({ status: 'observed', patterns: [] }),
    },
    'column-roles': {
      columnRoleHints: (table: { name: string }) => [
        { table: table.name, column: 'id', candidates: [{ role: 'candidate-key', score: 0.8, evidence: 'sort key' }], ambiguous: false, kind: 'metadata-hint' },
        { table: table.name, column: 'x', candidates: [], ambiguous: false, kind: 'metadata-hint' },
      ],
    },
    'sample-policy': {
      schemaForAssistant: (schema: DiscoveredSchema, policy?: { mode: string }) => {
        record('policy', [policy]);
        const { grainChecks: _g, joinCandidates: _j, ...rest } = schema;
        void _g; void _j;
        return {
          ...rest,
          analysis: schema.analysis && { ...schema.analysis, findings: schema.analysis.findings.map(({ proof: _p, ...finding }) => { void _p; return finding; }) },
          tables: schema.tables.map(table => ({ ...table, columns: table.columns.map(column => (policy?.mode === 'all' || !column.stats ? column : { ...column, stats: { distinct: column.stats.distinct } })) })),
        };
      },
    },
    'measure-checks': {
      verifyMeasures: async () => [
        { check: 'M1', dataset: 'orders', measure: 'revenue', outcome: 'passed', reason: 'Routes agree.', proof: { sql: 'x' } },
        { check: 'M2', dataset: 'orders', measure: 'count', outcome: 'skipped', reason: 'Budget.', proof: null },
      ],
    },
    'field-column': { resolveFieldColumn: (_dataset: unknown, field: string) => field },
  } as unknown as OnboardEngineModules;
  for (const [name, module] of Object.entries(overrides)) Object.assign((modules as unknown as Record<string, object>)[name]!, module);
  const engine: OnboardEngine = { version: '0.1.4', directory: '/engine', from: 'project', modules };
  return { engine, calls };
}

const query = vi.fn(async (_input: unknown, sql: string) => (sql === 'SELECT profile' ? 'profile' : ''));

async function json(run: () => Promise<void>) {
  const out: string[] = [];
  enableJsonOutput(text => { out.push(text); });
  try {
    await run();
  } finally {
    disableJsonOutput();
  }
  return JSON.parse(out.join(''));
}

const temporary: string[] = [];
afterEach(async () => {
  disableJsonOutput();
  await Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

describe('hypequery schema inspect', () => {
  it('reports discovery under the sample policy, without first-pass findings', async () => {
    const { engine, calls } = fakeEngine();
    const result = await json(() => schemaCommand('inspect', {}, { engine, query, input }));
    expect(result.engine).toEqual({ package: '@hypequery/onboard-engine', version: '0.1.4', from: 'project' });
    expect(result.connection).toEqual({ host: 'http://localhost:8123', database: 'shop', username: 'reader' });
    expect(result.schema.tables.map((table: { name: string }) => table.name)).toEqual(['orders', 'customers']);
    expect(result.schema.analysis).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('a@x.com');
    expect(JSON.stringify(result)).not.toContain('pw');
    expect(calls.policy).toEqual([[{ mode: 'detected', overrides: [] }]]);
  });

  it('narrows to --tables and passes --samples all', async () => {
    const { engine } = fakeEngine();
    const result = await json(() => schemaCommand('inspect', { tables: 'orders,nope', samples: 'all' }, { engine, query, input }));
    expect(result.schema.tables.map((table: { name: string }) => table.name)).toEqual(['orders']);
    expect(JSON.stringify(result)).toContain('a@x.com');
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLES' })]);
  });

  it.each([
    [undefined, {}],
    ['inspect', { samples: 'some' }],
    ['inspect', { join: 'a.b=c.d' }],
  ])('refuses usage %s %j', async (action, options) => {
    const { engine } = fakeEngine();
    await expect(schemaCommand(action, options, { engine, query, input })).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('turns an unreachable ClickHouse into CONNECTION_FAILED (transient)', async () => {
    const { engine } = fakeEngine();
    const refused = vi.fn(async () => { throw new ClickHouseConnectionError('Connection refused.'); });
    await expect(schemaCommand('inspect', {}, { engine, query: refused, input }))
      .rejects.toMatchObject({ code: 'CONNECTION_FAILED', exitClass: 'transient', retryable: true });
    const denied = vi.fn(async () => { throw new ClickHouseConnectionError('Authentication failed.', 516, 'access'); });
    await expect(schemaCommand('inspect', {}, { engine, query: denied, input }))
      .rejects.toMatchObject({ code: 'CLICKHOUSE_ACCESS_DENIED', exitClass: 'correctable' });
  });
});

describe('hypequery onboard analyze', () => {
  it('returns every part of the analysis, without customer-only proof', async () => {
    const { engine, calls } = fakeEngine();
    const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
    expect(result.tables).toEqual(['orders', 'customers']);
    expect(result.connection).toMatchObject({ readonly: 2, risks: [], profileFix: null });
    expect(result.findings).toEqual([expect.objectContaining({ id: 'statuses:orders' })]);
    expect(result.questions).toEqual([{ id: 'statuses:orders', table: 'orders', question: 'Which statuses count as revenue?', askBeforeDraft: true }]);
    expect(result.grainChecks).toEqual([{ id: 'G2', table: 'orders', status: 'finding', summary: 'Duplicate ids.' }]);
    expect(result.joinCandidates.candidates).toEqual([expect.objectContaining({ id: 'j1', outcome: 'proposed' })]);
    expect(result.columnRoles).toHaveLength(2);
    expect(result.columnRoles.every((role: { candidates: unknown[] }) => role.candidates.length > 0)).toBe(true);
    expect(result.tenantKeyCandidates.candidates).toEqual([{ table: 'orders', column: 'tenant_id' }, { table: 'orders', column: 'customer_id' }]);
    expect(result.tenantKeyCandidates.note).toContain('never set tenantKey');
    expect(JSON.stringify(result)).not.toMatch(/"proof"|"examples"|SELECT secret/);
    expect(calls.grain).toEqual([[['orders', 'customers']]]);
    expect((calls.capabilities![0] as unknown[])[3]).toEqual({ includeQueryLog: true });
  });

  it('degrades to a warning when query history has no grant', async () => {
    const { engine } = fakeEngine();
    const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
    expect(result.queryHistory).toEqual({ status: 'skipped', reason: 'Query history was unavailable.' });
    expect(result.warnings).toEqual([expect.objectContaining({
      code: 'QUERY_HISTORY_UNAVAILABLE',
      message: expect.stringContaining('no SELECT on system.query_log'),
      hint: expect.stringContaining('GRANT SELECT ON system.query_log TO `reader`;'),
    })]);
  });

  it('reports observed query history through the engine\'s provider-safe context', async () => {
    const { engine, calls } = fakeEngine({ 'query-history': { inspectQueryHistory: async () => ({ status: 'observed', patterns: [{ shape: 'SELECT secret' }] }) } });
    const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
    expect(result.queryHistory).toEqual({ status: 'observed', patterns: [] });
    expect(result.warnings).toEqual([]);
    expect(calls.history).toBeUndefined();
  });

  it('skips query history with --no-query-history', async () => {
    const { engine, calls } = fakeEngine();
    const result = await json(() => onboardCommand('analyze', undefined, { queryHistory: false }, { engine, query, input }));
    expect(result.queryHistory).toEqual({ status: 'skipped', reason: 'Skipped with --no-query-history.' });
    expect(calls.history).toBeUndefined();
    expect((calls.capabilities![0] as unknown[])[3]).toEqual({ includeQueryLog: false });
  });

  it('warns and skips capability checks when the settings profile is unreadable', async () => {
    const { engine, calls } = fakeEngine();
    const unreadable = vi.fn(async () => 'garbage');
    const result = await json(() => onboardCommand('analyze', undefined, { tables: 'orders' }, { engine, query: unreadable, input }));
    expect(result.warnings.map((warning: { code: string }) => warning.code)).toContain('ACCESS_PROFILE_UNREADABLE');
    expect(result.connection.capabilities).toEqual([]);
    expect(calls.capabilities).toBeUndefined();
    expect(calls.grain).toEqual([[['orders']]]);
  });

  it('refuses a file or --join', async () => {
    const { engine } = fakeEngine();
    await expect(onboardCommand('analyze', 'x.ts', {}, { engine, query, input })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(onboardCommand('analyze', undefined, { join: 'a.b=c.d' }, { engine, query, input })).rejects.toMatchObject({ code: 'USAGE' });
    await expect(onboardCommand('nope', undefined, {}, { engine, query, input })).rejects.toMatchObject({ code: 'USAGE' });
  });
});

describe('hypequery onboard check', () => {
  async function contractFile(datasets: unknown[]) {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-onboard-check-')));
    temporary.push(dir);
    const file = path.join(dir, 'deployment.json');
    await writeFile(file, JSON.stringify({ kind: 'hypequery-deployment', version: 2, datasets }));
    return { dir, file };
  }
  const dataset = (name: string, source: string, relationships: unknown[] = []) => ({
    name,
    source,
    tenant: { kind: 'not-required' },
    dimensions: [{ name: 'id', type: 'number', source: { kind: 'column', column: 'id' } }],
    measures: [{ name: 'orderCount', type: 'number', aggregate: 'count', field: 'id' }],
    filters: [],
    relationships,
  });

  it('runs measure checks and declared joins, and passes when nothing failed', async () => {
    const { engine } = fakeEngine();
    const { file } = await contractFile([
      dataset('orders', 'orders', [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_id', to: 'id', queryable: true }]),
      dataset('customers', 'customers'),
    ]);
    const prepare = vi.spyOn(await import('@hypequery/protocol'), 'prepareProtocolDeploymentContract');
    prepare.mockImplementation(((value: unknown) => ({ contract: value, identity: 'x' })) as never);
    try {
      const result = await json(() => onboardCommand('check', file, {}, { engine, query, input }));
      expect(result.ok).toBe(true);
      expect(result.source).toMatchObject({ path: file, kind: 'contract', datasets: ['orders', 'customers'] });
      expect(result.summary).toEqual({ measures: { passed: 1, failed: 0, skipped: 1 }, joins: { passed: 1, failed: 0, skipped: 0 } });
      expect(result.joinChecks).toEqual([expect.objectContaining({ relationship: 'orders.customer', status: 'measured', summary: 'summary customer_id', problem: null })]);
      expect(JSON.stringify(result)).not.toContain('"proof"');
    } finally {
      prepare.mockRestore();
    }
  });

  it('fails with ONBOARD_CHECK_FAILED and one issue per problem', async () => {
    const { engine } = fakeEngine({
      'measure-checks': { verifyMeasures: async () => [{ check: 'M2', dataset: 'orders', measure: 'revenue', outcome: 'failed', reason: 'Routes differ by 12%.' }] },
    });
    const { file } = await contractFile([dataset('orders', 'orders')]);
    const prepare = vi.spyOn(await import('@hypequery/protocol'), 'prepareProtocolDeploymentContract');
    prepare.mockImplementation(((value: unknown) => ({ contract: value, identity: 'x' })) as never);
    try {
      const error = await onboardCommand('check', file, { join: 'orders.tenant_id=customers.id' }, { engine, query, input }).catch(caught => caught);
      expect(error).toMatchObject({ code: 'ONBOARD_CHECK_FAILED', exitClass: 'correctable' });
      expect(error.issues).toEqual([
        { path: 'measures/orders.revenue/M2', message: 'Routes differ by 12%.' },
        { path: 'joins/orders.tenant_id=customers.id', message: 'Not unique.' },
      ]);
    } finally {
      prepare.mockRestore();
    }
  });

  it('fails when a dataset source is not in ClickHouse, without running measure checks', async () => {
    const verifyMeasures = vi.fn();
    const { engine } = fakeEngine({ 'measure-checks': { verifyMeasures } });
    const { file } = await contractFile([dataset('ghost', 'ghost_table')]);
    const prepare = vi.spyOn(await import('@hypequery/protocol'), 'prepareProtocolDeploymentContract');
    prepare.mockImplementation(((value: unknown) => ({ contract: value, identity: 'x' })) as never);
    try {
      await expect(onboardCommand('check', file, {}, { engine, query, input }))
        .rejects.toMatchObject({ code: 'ONBOARD_CHECK_FAILED', issues: [{ path: 'sources/ghost_table', message: expect.any(String) }] });
      expect(verifyMeasures).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
    }
  });

  it('needs a datasets source', async () => {
    const { engine } = fakeEngine();
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-onboard-empty-')));
    temporary.push(cwd);
    await expect(onboardCommand('check', undefined, {}, { engine, query, input, cwd })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(onboardCommand('check', 'missing.ts', {}, { engine, query, input, cwd })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(onboardCommand('check', undefined, { tables: 'a' }, { engine, query, input, cwd })).rejects.toMatchObject({ code: 'USAGE' });
  });
});
