/**
 * The CORE-11/CORE-12 seam.
 *
 * `@hypequery/deployment` deliberately depends only on `@hypequery/protocol`,
 * so the portable executor lives in `@hypequery/datasets` and is injected. That
 * keeps the two packages siblings, but it also means nothing type-checks the
 * join at build time — this test is what proves the halves actually compose,
 * and that a bundle can answer a dataset or metric call without a separate MCP
 * config.
 *
 * `@hypequery/datasets` is a devDependency only; nothing here ships.
 */

import { createPortableSemanticExecutor } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
  toProtocolSemanticInvocationFailure,
} from './semantic-data-plane.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';

const REVISION = 'a'.repeat(64);

const ENDPOINT = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: [] },
  tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
  maxLimit: 200,
} as const;

function contract(metricKind: 'metric' | 'derived-metric' = 'metric') {
  return {
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
        kind: metricKind,
        expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
        dimensions: ['status'],
        filters: ['status'],
        grains: ['day', 'month'],
        endpoint: ENDPOINT,
      }],
      relationships: [],
      limits: { maxResultSize: 1_000 },
      endpoint: ENDPOINT,
    }],
    queries: [],
    artifacts: [],
  };
}

function builderFactory(rows: Record<string, unknown>[]) {
  const sql: string[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table: string) {
      const parts: string[] = [];
      const chain = new Proxy({} as QueryBuilderLike, {
        get: (_target, property: string) => {
          if (property === 'execute') {
            return async () => {
              sql.push(`SELECT ${parts.join(' ')} FROM ${table}`);
              return rows;
            };
          }
          if (property === 'toSQLWithParams') {
            return () => ({ sql: `SELECT ${parts.join(' ')} FROM ${table}`, parameters: [] });
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
  return { factory, sql };
}

function invocation(operation: unknown) {
  return {
    kind: 'hypequery-semantic-invocation',
    version: 1,
    target: { project: 'acme', environment: 'production' },
    operation,
  };
}

function wire(rows: Record<string, unknown>[], metricKind?: 'metric' | 'derived-metric') {
  const { factory, sql } = builderFactory(rows);
  const plane = createDeploymentSemanticDataPlane({
    deployment: contract(metricKind) as never,
    activationRevision: REVISION,
    authenticate: async () => ({ subject: 'u1', roles: ['analyst'], scopes: [] }),
    resolveTenant: async () => 'acme',
    execute: createPortableSemanticExecutor({ queryBuilder: factory }) as never,
  });
  return { plane, sql };
}

describe('semantic invocation end to end', () => {
  it('answers a dataset call from the contract alone', async () => {
    const { plane, sql } = wire([{ status: 'paid', revenue: 10 }]);

    const result = await plane.invoke({
      invocation: invocation({
        kind: 'dataset', dataset: 'orders', dimensions: ['status'], measures: ['revenue'],
      }),
      credentials: 'token',
    });

    // Validated against the portable record by the data plane on the way out.
    expect(result.kind).toBe('hypequery-semantic-invocation-result');
    expect(result.activationRevision).toBe(REVISION);
    expect(result.meta.rowCount).toBe(1);
    // No MCP config and no customer module: the physical table came from the
    // contract by way of rehydration.
    expect(sql[0]).toContain('analytics.orders');
    expect(sql[0]).toContain('tenant_id');
  });

  it('answers a metric call', async () => {
    const { plane } = wire([{ status: 'paid', totalRevenue: 10 }]);

    const result = await plane.invoke({
      invocation: invocation({
        kind: 'metric', dataset: 'orders', metric: 'totalRevenue', dimensions: ['status'],
      }),
      credentials: 'token',
    });

    expect(result.meta.rowCount).toBe(1);
  });

  it('applies the endpoint ceiling to an omitted limit', async () => {
    const { plane, sql } = wire([{ status: 'paid' }]);

    await plane.invoke({
      invocation: invocation({ kind: 'dataset', dataset: 'orders', measures: ['revenue'] }),
      credentials: 'token',
    });

    // endpoint.maxLimit is 200; the planner over-fetches one row for hasMore.
    expect(sql[0]).toContain('limit(201)');
  });

  it('fails a derived metric closed, as unsupported rather than as an error', async () => {
    const { plane } = wire([{ status: 'paid' }], 'derived-metric');

    try {
      await plane.invoke({
        invocation: invocation({ kind: 'metric', dataset: 'orders', metric: 'totalRevenue' }),
        credentials: 'token',
      });
      throw new Error('expected the invocation to fail');
    } catch (error) {
      // The data plane maps an executor throw to executor-failed by default.
      // CORE-17 carries the expression that makes this executable; until then
      // the caller must be told the capability is missing, not that a query
      // broke.
      expect(error).toBeInstanceOf(DeploymentSemanticInvocationError);
      const failure = toProtocolSemanticInvocationFailure(error, REVISION);
      expect(failure.category).toBe('unsupported-capability');
    }
  });

  it('still serves other targets when the contract holds a derived metric', async () => {
    const { plane } = wire([{ status: 'paid' }], 'derived-metric');

    const result = await plane.invoke({
      invocation: invocation({ kind: 'dataset', dataset: 'orders', measures: ['revenue'] }),
      credentials: 'token',
    });

    expect(result.meta.rowCount).toBe(1);
  });

  it('rejects a forged tenant before it reaches the executor', async () => {
    const { plane, sql } = wire([{ status: 'paid' }]);

    await expect(plane.invoke({
      invocation: { ...invocation({ kind: 'dataset', dataset: 'orders', measures: ['revenue'] }), tenant: 'globex' },
      credentials: 'token',
    })).rejects.toThrow(DeploymentSemanticInvocationError);
    expect(sql).toHaveLength(0);
  });
});
