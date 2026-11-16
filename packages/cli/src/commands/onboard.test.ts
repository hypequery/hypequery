import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../utils/logger.js';
import { disableJsonOutput, enableJsonOutput } from '../utils/machine-output.js';
import type { DiscoveredSchema, OnboardEngine, OnboardEngineModules } from '../utils/onboard/engine-types.js';
import { CHECK_JOINS_BUDGET_MS, onboardCommand, schemaCommand } from './onboard.js';

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
        { name: 'region', type: 'LowCardinality(String)', comment: '', supported: true, stats: { distinct: 2, samples: ['emea'] } },
        { name: 'channel', type: "Enum8('web' = 1, 'app' = 2)", comment: '', supported: true },
        { name: 'amount', type: 'Float64', comment: '', supported: true },
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
    'join-sql': {
      keyFamily: (column: { type: string }) => (/Int/.test(column.type) ? 'integer' : /^(LowCardinality\()?String/.test(column.type) ? 'text' : undefined),
      keyColumn: (table: { columns: { name: string; type: string; supported: boolean }[] }, name: string) =>
        table.columns.find(column => column.name === name && column.supported && /Int|String/.test(column.type)),
      declaredValues: (column: { type: string }) => /^Enum|^Bool/.test(column.type),
    },
    'sample-policy': {
      // Withholds a column's samples under `none`, or under `detected` when they look like an email.
      withheldBy: (schema: DiscoveredSchema, policy: { mode: string }) => (table: string, column: string) => {
        if (policy.mode === 'none') return true;
        if (policy.mode === 'all') return false;
        const found = schema.tables.find(item => item.name === table)?.columns.find(item => item.name === column);
        return !found || (found.stats?.samples ?? []).some(sample => sample.includes('@'));
      },
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

  it('fails with CLICKHOUSE_PROFILE_UNREADABLE (not retryable) when the settings profile is unreadable', async () => {
    const { engine, calls } = fakeEngine();
    const unreadable = vi.fn(async () => 'garbage');
    const error = await onboardCommand('analyze', undefined, {}, { engine, query: unreadable, input }).catch(caught => caught);
    expect(error).toMatchObject({ code: 'CLICKHOUSE_PROFILE_UNREADABLE', category: 'correctable_input', exitClass: 'correctable', retryable: false });
    expect(error.hint).toContain('settings profile');
    expect(calls.grain).toBeUndefined();
  });

  it('maps the engine\'s unexpected-profile error from discovery to CLICKHOUSE_PROFILE_UNREADABLE', async () => {
    const { engine } = fakeEngine({
      introspection: { discoverSchema: async () => { throw new ClickHouseConnectionError('ClickHouse returned an unexpected access profile.'); } },
    });
    await expect(schemaCommand('inspect', {}, { engine, query, input }))
      .rejects.toMatchObject({ code: 'CLICKHOUSE_PROFILE_UNREADABLE', retryable: false });
  });

  describe('join split values follow the sample policy', () => {
    const groups = [{ value: 'secret-a', childRows: 10, matchedRows: 10 }, { value: 'secret-b', childRows: 10, matchedRows: 0 }];
    const split = (column: string) => ({ table: 'orders', column, groups, truncated: false, conditional: true });
    function withSplits() {
      return fakeEngine({
        'join-candidate-runner': {
          verifyJoinCandidates: async () => ({
            candidates: ['region', 'email', 'channel'].map(column => ({
              id: column, child: { table: 'orders', column: 'customer_id' }, parent: { table: 'customers', column: 'id' },
              outcome: 'proposed',
              // The engine's own wording, with the matching values in it.
              reason: `orders.customer_id matches customers.id only where orders.${column} is secret-a; other rows don't match. Whether to join for those rows is a question for the user.`,
              split: split(column),
            })),
            omitted: 0,
          }),
        },
      });
    }
    const valuesOf = (result: { joinCandidates: { candidates: { id: string; split: { groups: { value?: unknown }[]; valuesWithheld?: boolean } }[] } }, id: string) =>
      result.joinCandidates.candidates.find(candidate => candidate.id === id)!.split;

    it('keeps values the default policy sends, and withholds detected ones', async () => {
      const { engine } = withSplits();
      const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
      expect(valuesOf(result, 'region').groups.map(group => group.value)).toEqual(['secret-a', 'secret-b']);
      expect(valuesOf(result, 'email')).toMatchObject({ valuesWithheld: true, groups: [{ childRows: 10, matchedRows: 10 }, { childRows: 10, matchedRows: 0 }] });
      expect(valuesOf(result, 'email').groups.every(group => !('value' in group))).toBe(true);
      const reasons = Object.fromEntries(result.joinCandidates.candidates.map((candidate: { id: string; reason: string }) => [candidate.id, candidate.reason]));
      expect(reasons.region).toContain('is secret-a');
      expect(reasons.email).toBe('orders.customer_id matches customers.id only for some values of orders.email (values withheld by the sample policy); '
        + 'other rows don\'t match. Whether to join for those rows is a question for the user.');
    });

    it('keeps withheld values out of the printed join reasons too', async () => {
      vi.mocked(logger.indent).mockClear();
      const { engine } = withSplits();
      await onboardCommand('analyze', undefined, { samples: 'none' }, { engine, query, input });
      const printed = vi.mocked(logger.indent).mock.calls.map(call => String(call[0])).filter(line => line.includes('→'));
      expect(printed).toHaveLength(3);
      expect(printed.filter(line => line.includes('secret-'))).toEqual([expect.stringContaining('orders.channel is secret-a')]);
    });

    it('withholds every sampled split value under --samples none, but not values the type declares', async () => {
      const { engine } = withSplits();
      const result = await json(() => onboardCommand('analyze', undefined, { samples: 'none' }, { engine, query, input }));
      expect(valuesOf(result, 'region')).toMatchObject({ valuesWithheld: true, conditional: true });
      expect(valuesOf(result, 'email')).toMatchObject({ valuesWithheld: true });
      expect(valuesOf(result, 'channel').groups.map(group => group.value)).toEqual(['secret-a', 'secret-b']);
      expect(JSON.stringify(result.joinCandidates.candidates.filter((candidate: { id: string }) => candidate.id !== 'channel'))).not.toContain('secret-');
    });
  });

  describe('partition IDs follow the sample policy', () => {
    // A table partitioned by tenant: its partition ID is a tenant ID.
    const partitioned = (partitionKey: string): DiscoveredSchema => ({
      ...SCHEMA,
      tables: SCHEMA.tables.map(table => (table.name === 'orders' ? { ...table, partitionKey, recentPartitionId: 'acme-corp' } : table)),
    });
    function engineFor(schema: DiscoveredSchema) {
      return fakeEngine({
        introspection: { discoverSchema: async () => schema },
        'grain-check-runner': {
          verifyGrainChecks: async (_i: unknown, _q: unknown, discovered: DiscoveredSchema) => ({
            ...discovered,
            grainChecks: [{ id: 'G2', table: 'orders', status: 'passed', summary: 'ok', scope: { kind: 'recent-partition', partitionId: 'acme-corp', maxRows: 10 } }],
          }),
        },
        'join-candidate-runner': {
          verifyJoinCandidates: async () => ({
            candidates: [{ id: 'j1', child: { table: 'orders', column: 'customer_id' }, parent: { table: 'customers', column: 'id' }, outcome: 'proposed', reason: 'ok', scope: { kind: 'recent-partition', partitionId: 'acme-corp', maxRows: 10 } }],
            omitted: 0,
          }),
        },
      });
    }

    it('withholds them everywhere under --samples none', async () => {
      const { engine } = engineFor(partitioned('region'));
      const result = await json(() => onboardCommand('analyze', undefined, { samples: 'none' }, { engine, query, input }));
      expect(JSON.stringify(result)).not.toContain('acme-corp');
      expect(result.schema.tables[0]).toMatchObject({ name: 'orders', recentPartitionWithheld: true });
      expect(result.grainChecks[0].scope).toEqual({ kind: 'recent-partition', maxRows: 10, partitionWithheld: true });
      expect(result.joinCandidates.candidates[0].scope).toMatchObject({ partitionWithheld: true });
      const inspected = await json(() => schemaCommand('inspect', { samples: 'none' }, { engine, query, input }));
      expect(JSON.stringify(inspected)).not.toContain('acme-corp');
    });

    it('withholds them by default when the partition key reads a withheld column, or no column', async () => {
      for (const key of ['cityHash64(email) % 16', 'rand()']) {
        const { engine } = engineFor(partitioned(key));
        const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
        expect(JSON.stringify(result)).not.toContain('acme-corp');
      }
    });

    it('keeps them when the policy shows the key\'s columns, and under --samples all', async () => {
      const { engine } = engineFor(partitioned('region'));
      const result = await json(() => onboardCommand('analyze', undefined, {}, { engine, query, input }));
      expect(result.schema.tables[0].recentPartitionId).toBe('acme-corp');
      expect(result.grainChecks[0].scope.partitionId).toBe('acme-corp');
      const all = await json(() => schemaCommand('inspect', { samples: 'all' }, { engine: engineFor(partitioned('rand()')).engine, query, input }));
      expect(all.schema.tables[0].recentPartitionId).toBe('acme-corp');
    });
  });

  it('prints ClickHouse names and engine text without terminal control characters', async () => {
    const hostile = '\u001b]0;owned\u0007\u001b[2J\u009b31m';
    const schema: DiscoveredSchema = {
      ...SCHEMA,
      tables: [...SCHEMA.tables, { name: `evil${hostile}`, comment: hostile, supported: false, engine: `Log${hostile}`, columns: [] }],
      analysis: { ...SCHEMA.analysis!, findings: [{ id: 'f', table: 'orders', kind: 'x', finding: `Look${hostile}`, question: `Ask${hostile}` }] },
    };
    const { engine } = fakeEngine({
      introspection: { discoverSchema: async () => schema },
      'join-candidate-runner': {
        verifyJoinCandidates: async () => ({
          candidates: [{ id: 'j1', child: { table: 'orders', column: 'customer_id' }, parent: { table: 'customers', column: 'id' }, outcome: 'proposed', reason: `Reason${hostile}` }],
          omitted: 0,
        }),
      },
    });
    const printed = () => Object.values(logger).flatMap(fn => (vi.mocked(fn).mock.calls as unknown[][]).map(call => String(call[0])));
    for (const fn of Object.values(logger)) vi.mocked(fn).mockClear();
    await onboardCommand('analyze', undefined, { tables: `orders,evil${hostile}` }, { engine, query, input });
    await schemaCommand('inspect', {}, { engine, query, input });
    const lines = printed();
    expect(lines.join('\n')).toContain('evil ]0;owned');
    expect(lines.join('\n')).toContain('Reason ]0;owned');
    for (const line of lines) expect(line).not.toMatch(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/);
    // --json keeps the values as ClickHouse returned them; JSON escapes them.
    const result = await json(() => schemaCommand('inspect', {}, { engine, query, input }));
    expect(result.schema.tables.at(-1).name).toBe(`evil${hostile}`);
  });

  it('warns once on stderr when credentials would go over plain http to a remote host', async () => {
    vi.mocked(logger.warn).mockClear();
    const { engine } = fakeEngine();
    const remote = { ...input, host: 'http://ch.internal:8123' };
    await schemaCommand('inspect', {}, { engine, query, input: remote });
    await schemaCommand('inspect', {}, { engine, query, input: remote });
    const warnings = vi.mocked(logger.warn).mock.calls.filter(call => String(call[0]).includes('unencrypted'));
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]![0])).toContain('ch.internal');
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
      const error = await onboardCommand('check', file, { join: 'orders.id=customers.id' }, { engine, query, input }).catch(caught => caught);
      expect(error).toMatchObject({ code: 'ONBOARD_CHECK_FAILED', exitClass: 'correctable' });
      expect(error.issues).toEqual([
        { path: 'measures/orders.revenue/M2', message: 'Routes differ by 12%.' },
        { path: 'joins/orders.id=customers.id', message: 'Not unique.' },
      ]);
    } finally {
      prepare.mockRestore();
    }
  });

  async function withContract<T>(datasets: unknown[], run: (file: string) => Promise<T>): Promise<T> {
    const { file } = await contractFile(datasets);
    const prepare = vi.spyOn(await import('@hypequery/protocol'), 'prepareProtocolDeploymentContract');
    prepare.mockImplementation(((value: unknown) => ({ contract: value, identity: 'x' })) as never);
    try {
      return await run(file);
    } finally {
      prepare.mockRestore();
    }
  }

  it.each([
    ['a misspelled column', { from: 'custmer_id', to: 'id' }, 'orders has no column custmer_id.'],
    ['keys of different types', { from: 'tenant_id', to: 'id' }, 'have different key types'],
  ])('fails a declared relationship with %s, without measuring it', async (_name, keys, message) => {
    const checkJoin = vi.fn();
    const { engine } = fakeEngine({ 'join-check': { checkJoin } });
    await withContract([
      dataset('orders', 'orders', [{ name: 'customer', kind: 'belongsTo', target: 'customers', queryable: true, ...keys }]),
      dataset('customers', 'customers'),
    ], async (file) => {
      const error = await onboardCommand('check', file, {}, { engine, query, input }).catch(caught => caught);
      expect(error).toMatchObject({ code: 'ONBOARD_CHECK_FAILED' });
      expect(error.issues).toEqual([{ path: 'joins/orders.customer', message: expect.stringContaining(message) }]);
    });
    expect(checkJoin).not.toHaveBeenCalled();
  });

  it('fails a --join whose table does not exist', async () => {
    const { engine } = fakeEngine();
    await withContract([dataset('orders', 'orders')], async (file) => {
      await expect(onboardCommand('check', file, { join: 'orders.customer_id=custmers.id' }, { engine, query, input }))
        .rejects.toMatchObject({ issues: [{ path: 'joins/orders.customer_id=custmers.id', message: 'Table custmers was not found in ClickHouse.' }] });
    });
  });

  it('warns, and still passes, when a join exists but cannot be measured', async () => {
    const { engine } = fakeEngine({
      'join-check': { checkJoin: async (_schema: unknown, request: object) => ({ ...request, status: 'skipped', reason: 'The bounded query exceeded its read limit.' }) },
    });
    await withContract([
      dataset('orders', 'orders', [{ name: 'customer', kind: 'belongsTo', target: 'customers', from: 'customer_id', to: 'id', queryable: true }]),
      dataset('customers', 'customers'),
    ], async (file) => {
      const result = await json(() => onboardCommand('check', file, { join: 'orders.amount=customers.id' }, { engine, query, input }));
      expect(result.ok).toBe(true);
      expect(result.summary.joins).toEqual({ passed: 0, failed: 0, skipped: 2 });
      expect(result.warnings.filter((warning: { code: string }) => warning.code === 'JOIN_NOT_MEASURED')).toHaveLength(2);
      expect(result.joinChecks[1]).toMatchObject({ status: 'skipped', problem: expect.stringContaining('not a key type') });
    });
  });

  it('bounds every join query by one overall deadline, and skips joins once it has passed', async () => {
    let clock = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const deadlines: (number | undefined)[] = [];
    const { engine } = fakeEngine({
      'join-candidate-runner': {
        boundedJoinQuery: async (target: typeof input, run: (i: typeof input, sql: string, options: { maxBytes: number; timeoutMs: number; deadlineMs?: number }) => Promise<string>) =>
          async (sql: string) => run(target, sql, { maxBytes: 1, timeoutMs: 5_000, deadlineMs: clock + 30_000 }),
      },
      'join-check': {
        checkJoin: async (_schema: unknown, request: object, joinQuery: (sql: string) => Promise<string>) => {
          await joinQuery('SELECT join');
          clock += CHECK_JOINS_BUDGET_MS - 1_000;
          return { ...request, status: 'measured', reason: '', unique: true };
        },
        joinProblem: () => null,
      },
    });
    const recording = vi.fn(async (_i: unknown, sql: string, options: { deadlineMs?: number }) => {
      if (sql === 'SELECT join') deadlines.push(options.deadlineMs);
      return sql === 'SELECT profile' ? 'profile' : '';
    });
    try {
      await withContract([dataset('orders', 'orders')], async (file) => {
        const result = await json(() => onboardCommand('check', file, { join: 'orders.customer_id=customers.id,orders.id=customers.id,orders.tenant_id=orders.email' }, { engine, query: recording, input }));
        expect(deadlines).toEqual([1_000_000 + 30_000, 1_000_000 + CHECK_JOINS_BUDGET_MS]);
        expect(result.joinChecks[2]).toMatchObject({ status: 'skipped', reason: expect.stringContaining('join budget') });
        expect(result.ok).toBe(true);
      });
    } finally {
      now.mockRestore();
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
