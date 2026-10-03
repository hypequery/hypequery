import { describe, expect, it, vi } from 'vitest';
import { add, between, createDatasetClient, createInMemoryBackend, createPortableSemanticRuntime, dataset, dimension, eq, measure, publishToCloud } from './index.js';
import type { DatasetQuery } from './index.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

const orders = dataset('orders', {
  source: 'private_orders', tenantKey: 'tenant_id', timeKey: 'createdAt',
  dimensions: { amount: dimension.number(), status: dimension.string(), createdAt: dimension.timestamp() },
  measures: {
    revenue: measure.sum('amount'),
    doubled: measure.derived({ uses: { revenue: 'revenue' }, formula: ({ revenue }) => add(revenue, revenue) }),
    running: measure.cumulative('revenue'),
  },
  limits: { maxResultSize: 2 },
});
const context = { runtime: { tenant: 'private-tenant' } };

function recordingFactory() {
  const factory = createRenderingBuilderFactory();
  const executed: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const rows = [{ revenue: 10 }, { revenue: 20 }, { revenue: 30 }];
  const table = factory.table;
  factory.table = vi.fn(name => {
    const builder = table(name);
    builder.execute = async <T>(options?: { abortSignal?: AbortSignal }) => {
      executed.push(builder.toSQLWithParams().sql);
      signals.push(options?.abortSignal);
      return rows as T[];
    };
    return builder;
  });
  factory.rawQuery = vi.fn(async <T>(sql: string, _params?: unknown[], options?: { abortSignal?: AbortSignal }) => {
    executed.push(sql);
    signals.push(options?.abortSignal);
    return rows as T[];
  });
  return { factory, executed, signals };
}

describe('shared dataset compilation', () => {
  it('previews the effective ceiling and overfetch SQL, then plans once during execution', async () => {
    const { factory, executed } = recordingFactory();
    const client = createDatasetClient({ queryBuilder: factory });
    const compiled = client.compileDataset(orders, {}, context);
    expect(compiled.describe()).toMatchObject({ plan: 'aggregate', effectiveLimit: 2, executionLimit: 3, measures: ['revenue'], timezone: 'UTC' });
    expect(compiled.sql).toContain('LIMIT 3');
    vi.mocked(factory.table).mockClear();
    const result = await client.execute(orders, {}, context);
    expect(factory.table).toHaveBeenCalledTimes(1);
    expect(executed).toEqual([compiled.sql]);
    expect(result.data).toHaveLength(2);
    expect(result.meta).toMatchObject({ resultLimit: { applied: 2 }, pagination: { limit: 2, hasMore: true } });
    // Preserve the shipped logical SQL API; compileDataset is the execution preview.
    expect(client.toSQL(orders, { limit: 1 }, context)).toContain('LIMIT 1');
    expect(client.compileDataset(orders, { limit: 1 }, context).sql).toContain('LIMIT 2');
  });

  it.each(['derived', 'time'] as const)('previews all statements on the %s path', async plan => {
    const { factory, executed, signals } = recordingFactory();
    const client = createDatasetClient({ queryBuilder: factory });
    const query: DatasetQuery = plan === 'derived'
      ? { measures: ['doubled'], limit: 1 }
      : { measures: ['running'], by: 'day', filters: [between('createdAt', '2026-01-01', '2026-01-03')], limit: 1 };
    const signal = new AbortController().signal;
    const runtime = { ...context, abortSignal: signal };
    const compiled = client.compileDataset(orders, query, runtime);
    expect(compiled.describe().plan).toBe(plan);
    expect(compiled.describe().measureDependencies).toEqual(plan === 'derived' ? ['revenue', 'doubled'] : ['revenue', 'running']);
    expect(compiled.preflightStatements).toHaveLength(plan === 'time' ? 1 : 0);
    await client.execute(orders, query, runtime);
    expect(executed).toEqual([...compiled.preflightStatements.map(statement => statement.sql), compiled.sql]);
    expect(signals.every(value => value === signal)).toBe(true);
  });

  it('keeps values and SQL out of JSON diagnostics, even with a literal-inlining builder', () => {
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    const compiled = client.compileDataset(orders, { filters: [eq('status', 'private-value')] }, context);
    expect(compiled.sql).toContain('private-value');
    const debug = JSON.stringify(compiled);
    for (const secret of ['private-value', 'private-tenant', 'private_orders', 'tenant_id', 'SELECT']) expect(debug).not.toContain(secret);
    expect(JSON.parse(debug).filters).toEqual([{ field: 'status', operator: 'eq' }]);
    expect(Object.isFrozen(compiled.describe().filters)).toBe(true);
  });

  it('preserves bound parameters while isolating preview from later input changes', () => {
    const factory = createRenderingBuilderFactory();
    const table = factory.table;
    factory.table = name => {
      const builder = table(name);
      const render = builder.toSQLWithParams;
      builder.toSQLWithParams = () => ({
        sql: render().sql.replace("'private-value'", '?'),
        parameters: ['private-value'],
      });
      return builder;
    };
    const client = createDatasetClient({ queryBuilder: factory });
    const query = { filters: [eq('status', 'private-value')] };
    const compiled = client.compileDataset(orders, query, context);
    query.filters[0]!.value = 'changed';
    expect(compiled.parameters).toEqual(['private-value']);
    expect(compiled.query.filters?.[0]?.value).toBe('private-value');
    expect(compiled.sql).toContain('?');
    expect(compiled.describe().parameterCount).toBe(1);
    expect(JSON.stringify(compiled)).not.toContain('private-value');
  });

  it('uses the runtime builder override and rejects invalid inputs without execution', () => {
    const fallback = createRenderingBuilderFactory();
    fallback.table = () => { throw new Error('unexpected default builder'); };
    const { factory, executed } = recordingFactory();
    const client = createDatasetClient({ queryBuilder: fallback });
    const runtime = { runtime: { ...context.runtime, builderFactory: factory } };
    expect(client.compileDataset(orders, { limit: 0, offset: 0 }, runtime).describe()).toMatchObject({ effectiveLimit: 0, executionLimit: 1, offset: 0 });
    expect(() => client.compileDataset(orders, { limit: 3 }, runtime)).toThrow('Too many results');
    expect(() => client.compileDataset(orders)).toThrow('tenant');
    expect(executed).toEqual([]);
  });

  it('refuses the frozen backend path', () => {
    const client = createDatasetClient({ backend: createInMemoryBackend({}) });
    expect(() => client.compileDataset(orders)).toThrow('queryBuilder execution path');
  });

  it('uses the same portable definition, budget and tenancy for Cloud preview and execution', async () => {
    const portable = dataset('orders', {
      source: 'private_orders', tenantKey: 'tenant_id',
      dimensions: { amount: dimension.number() }, measures: { revenue: measure.sum('amount') },
    });
    const deployment = publishToCloud({ datasets: { orders: portable }, access: { roles: [], scopes: [] } });
    const { factory, executed } = recordingFactory();
    const runtime = createPortableSemanticRuntime({ queryBuilder: factory });
    const input = {
      deployment, dataset: deployment.datasets[0]!, activationRevision: 'a'.repeat(64),
      operation: { kind: 'dataset' as const, dataset: deployment.datasets[0]!.name },
      tenant: 'private-tenant', budget: { maxRows: 2 },
    };
    const compiled = runtime.compile(input);
    expect(compiled.describe()).toMatchObject({ effectiveLimit: 2, executionLimit: 3, activationRevision: input.activationRevision });
    const result = await runtime.execute(input);
    expect(executed).toEqual([compiled.sql]);
    expect(result.meta).toMatchObject({ pagination: { limit: 2, hasMore: true } });
    expect(result.activationRevision).toBe(input.activationRevision);
  });
});
