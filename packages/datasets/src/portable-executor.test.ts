import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  createPortableSemanticExecutor,
  PortableExecutionBudgetError,
  PortableExecutionUnsupportedError,
  type PortableSemanticExecutionInput,
} from './portable-executor.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

const REVISION = 'a'.repeat(64);

const AUTHENTICATED = {
  access: { kind: 'authenticated', roles: [], scopes: [] },
  tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
} as const;

function deployment(metricOverrides: Record<string, unknown> = {}) {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [{
      name: 'orders',
      source: 'analytics.orders',
      tenant: { kind: 'required', field: 'tenant_id' },
      timeField: 'createdAt',
      dimensions: [
        {
          name: 'createdAt', type: 'timestamp', source: { kind: 'column', column: 'created_at' },
          filterable: true, groupable: true,
        },
        {
          name: 'status', type: 'string', source: { kind: 'column', column: 'status' },
          filterable: true, groupable: true,
        },
        {
          name: 'amount', type: 'number', source: { kind: 'column', column: 'amount_cents' },
          filterable: false, groupable: false,
        },
      ],
      measures: [{ name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] }],
      filters: [{ name: 'status', field: 'status', operators: ['eq'] }],
      metrics: [{
        name: 'totalRevenue',
        kind: 'metric',
        expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
        dimensions: ['status'],
        filters: ['status'],
        grains: ['day', 'month'],
        endpoint: AUTHENTICATED,
        ...metricOverrides,
      }],
      relationships: [],
      endpoint: AUTHENTICATED,
    }],
    queries: [],
    artifacts: [],
  });
}

/**
 * A builder whose every method chains back to itself, so only `execute` needs
 * describing. A fresh proxy per call would hand the planner a builder whose
 * `execute` is not the one under test.
 */
function chainingBuilder(
  execute: (options?: { abortSignal?: AbortSignal }) => Promise<unknown>,
): QueryBuilderLike {
  const builder = new Proxy({} as QueryBuilderLike, {
    get: (_target, property: string) => {
      if (property === 'execute') return execute;
      if (property === 'toSQLWithParams') return () => ({ sql: 'SELECT 1', parameters: [] });
      return () => builder;
    },
  });
  return builder;
}

/** Records the SQL the planner produced and returns canned rows. */
function recordingFactory(rows: Record<string, unknown>[] = [{ status: 'paid', revenue: 10 }]) {
  const sql: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table: string) {
      const parts: string[] = [];
      const chain = new Proxy({} as QueryBuilderLike, {
        get(_target, property: string) {
          if (property === 'toSQLWithParams') {
            return () => ({ sql: `SELECT ${parts.join(' ')} FROM ${table}`, parameters: [] });
          }
          if (property === 'execute') {
            return async (options?: { abortSignal?: AbortSignal }) => {
              signals.push(options?.abortSignal);
              sql.push(`SELECT ${parts.join(' ')} FROM ${table}`);
              if (options?.abortSignal?.aborted) {
                throw new Error('aborted');
              }
              return rows;
            };
          }
          return (...args: unknown[]) => {
            parts.push(`${property}(${args.filter(a => a !== undefined).map(String).join(',')})`);
            return chain;
          };
        },
      });
      return chain;
    },
    rawQuery: async () => [],
  };
  return { factory, sql, signals };
}

function input(
  overrides: Partial<PortableSemanticExecutionInput> = {},
  contract = deployment(),
): PortableSemanticExecutionInput {
  const dataset = contract.datasets[0];
  return {
    deployment: contract,
    dataset,
    operation: {
      kind: 'dataset', dataset: 'orders', dimensions: ['status'], measures: ['revenue'],
    } as never,
    tenant: 'acme',
    budget: { maxRows: 100 },
    activationRevision: REVISION,
    ...overrides,
  };
}

describe('portable semantic execution', () => {
  it('executes a dataset invocation from the contract alone', async () => {
    const { factory, sql } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    const result = await execute(input());

    expect(result).toMatchObject({
      kind: 'hypequery-semantic-invocation-result',
      version: 1,
      activationRevision: REVISION,
      meta: { rowCount: 1 },
    });
    expect(result.data).toHaveLength(1);
    // No customer module was loaded: the physical table and column mappings
    // came from the contract by way of rehydration.
    expect(sql[0]).toContain('analytics.orders');
  });

  it('executes a metric invocation against its rebuilt handle', async () => {
    const { factory } = recordingFactory([{ status: 'paid', totalRevenue: 10 }]);
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const contract = deployment();

    const result = await execute(input({
      metric: contract.datasets[0].metrics[0],
      operation: { kind: 'metric', dataset: 'orders', metric: 'totalRevenue', dimensions: ['status'] } as never,
    }, contract));

    expect(result.meta.rowCount).toBe(1);
  });

  it('applies the resolved tenant to the plan', async () => {
    const { factory, sql } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    await execute(input({ tenant: 'acme' }));

    expect(sql[0]).toContain('tenant_id');
    expect(sql[0]).toContain('acme');
  });

  // -- fail closed ---------------------------------------------------------

  it('refuses a derived metric until its expression is carried', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    // Contract v1 carries no symbolic expression, so planning it would be a
    // guess. Decision 0005 requires an explicit refusal instead.
    const contract = deployment({ kind: 'derived-metric' });

    await expect(execute(input({
      metric: contract.datasets[0].metrics[0],
      operation: { kind: 'metric', dataset: 'orders', metric: 'totalRevenue' } as never,
    }, contract))).rejects.toThrow(PortableExecutionUnsupportedError);
  });

  it('reports the unsupported-capability code a caller maps to a failure category', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const contract = deployment({ kind: 'derived-metric' });

    await execute(input({
      metric: contract.datasets[0].metrics[0],
      operation: { kind: 'metric', dataset: 'orders', metric: 'totalRevenue' } as never,
    }, contract)).catch((error: PortableExecutionUnsupportedError) => {
      expect(error.code).toBe('HQ_SEMANTIC_UNSUPPORTED_CAPABILITY');
      expect(error.message).toMatch(/derived/);
    });
    expect.assertions(2);
  });

  it('does not let one derived metric make the rest of the contract unexecutable', async () => {
    const { factory, sql } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    // Rehydration refuses a derived metric. Rebuilding the whole contract
    // eagerly would turn that single metric into a deployment-wide outage.
    const contract = deployment({ kind: 'derived-metric' });

    const result = await execute(input({
      operation: {
        kind: 'dataset', dataset: 'orders', dimensions: ['status'], measures: ['revenue'],
      } as never,
    }, contract));

    expect(result.meta.rowCount).toBe(1);
    expect(sql[0]).toContain('analytics.orders');
  });

  it('still refuses the derived metric itself', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const contract = deployment({ kind: 'derived-metric' });

    await expect(execute(input({
      metric: contract.datasets[0].metrics[0],
      operation: { kind: 'metric', dataset: 'orders', metric: 'totalRevenue' } as never,
    }, contract))).rejects.toThrow(PortableExecutionUnsupportedError);
  });

  it('refuses a filter the contract cannot express as a comparison', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    await expect(execute(input({
      operation: {
        kind: 'dataset', dataset: 'orders', measures: ['revenue'],
        filters: [{ kind: 'logical', operator: 'not', operand: { kind: 'literal', value: true } }],
      } as never,
    }))).rejects.toThrow(PortableExecutionUnsupportedError);
  });

  // -- budgets -------------------------------------------------------------

  it('applies the budget as the limit when the caller omits one', async () => {
    const { factory, sql } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    await execute(input({ budget: { maxRows: 25 } }));

    // Otherwise an omitted limit would be an unbounded scan. The planner asks
    // for one extra row so `hasMore` is exact without a second count query.
    expect(sql[0]).toContain('limit(26)');
  });

  it('bounds returned rows to the effective budget', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({ status: `s${index}` }));
    const { factory } = recordingFactory(rows);
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    const result = await execute(input({ budget: { maxRows: 3 } }));

    // The planner applies the limit itself; the executor's own row check is
    // defense-in-depth against a builder that ignores it.
    expect(result.data).toHaveLength(3);
    expect(result.meta.rowCount).toBe(3);
  });

  it('rejects a result that exceeds the response byte budget', async () => {
    const { factory } = recordingFactory([{ note: 'x'.repeat(500) }]);
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    const pending = execute(input({ budget: { maxRows: 100, maxResponseBytes: 64 } }));
    await expect(pending).rejects.toThrow(PortableExecutionBudgetError);
    await expect(pending).rejects.toThrow(/is \d+ bytes; the effective limit is 64/);
  });

  // -- cancellation and deadlines -----------------------------------------

  it('propagates a caller abort to the in-flight database request', async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const factory: QueryBuilderFactoryLike = {
      table: () => chainingBuilder(async options => {
        observed = options?.abortSignal;
        // Abort while the request is in flight, which is the only window that
        // matters — the listener is released once execution settles.
        controller.abort();
        throw new Error('aborted');
      }),
      rawQuery: async () => [],
    };
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    await expect(execute(input({ signal: controller.signal }))).rejects.toThrow();
    // Chained rather than the caller's own signal, so a deadline can abort
    // independently of the caller.
    expect(observed).not.toBe(controller.signal);
    expect(observed?.aborted).toBe(true);
  });

  it('aborts the underlying request when the deadline elapses', async () => {
    vi.useFakeTimers();
    try {
      let observed: AbortSignal | undefined;
      const factory: QueryBuilderFactoryLike = {
        table: () => chainingBuilder(async options => {
          observed = options?.abortSignal;
          return await new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }),
        rawQuery: async () => [],
      };
      const execute = createPortableSemanticExecutor({ queryBuilder: factory });
      const pending = execute(input({ budget: { maxRows: 10, deadlineMs: 1_000 } }));
      const assertion = expect(pending).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(1_100);
      await assertion;
      expect(observed?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to start when the caller has already aborted', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const controller = new AbortController();
    controller.abort();

    await expect(execute(input({ signal: controller.signal }))).rejects.toThrow();
  });

  // -- activation ----------------------------------------------------------

  it('rebuilds once per activation and again when it changes', async () => {
    const { factory } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });
    const first = deployment();
    const second = deployment();

    const a = await execute(input({}, first));
    const b = await execute(input({}, first));
    const c = await execute(input({ activationRevision: 'b'.repeat(64) }, second));

    expect(a.activationRevision).toBe(REVISION);
    expect(b.activationRevision).toBe(REVISION);
    // A rollback or roll-forward is a new revision, so the memo cannot serve a
    // superseded generation's catalog.
    expect(c.activationRevision).toBe('b'.repeat(64));
  });

  it('serves a rolled-back generation from its own contract', async () => {
    const { factory, sql } = recordingFactory();
    const execute = createPortableSemanticExecutor({ queryBuilder: factory });

    await execute(input({}, deployment()));
    const rolledBack = validateProtocolDeploymentContract(
      JSON.parse(JSON.stringify(deployment()).replace('analytics.orders', 'analytics.orders_v1')),
    );
    await execute(input({ activationRevision: 'c'.repeat(64) }, rolledBack));

    expect(sql[0]).toContain('analytics.orders');
    expect(sql[1]).toContain('analytics.orders_v1');
  });
});
