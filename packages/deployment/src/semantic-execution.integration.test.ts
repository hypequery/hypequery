/**
 * The CORE-11/CORE-12 seam.
 *
 * `@hypequery/deployment` deliberately depends only on `@hypequery/protocol`,
 * so the portable executor lives in `@hypequery/datasets` and is injected. That
 * keeps the two packages siblings, but it also means nothing type-checks the
 * join at build time — this test is what proves the halves actually compose,
 * and that a bundle can answer a dataset call, including a derived measure,
 * without a separate MCP config.
 *
 * `@hypequery/datasets` is a devDependency only; nothing here ships.
 */

import { createPortableSemanticExecutor } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
} from './semantic-data-plane.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';

const REVISION = 'a'.repeat(64);

const ENDPOINT = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: [] },
  tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
  maxLimit: 200,
} as const;

function contract() {
  return {
    kind: 'hypequery-deployment',
    version: 2,
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
      measures: [
        { name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] },
        { name: 'orderCount', aggregation: 'count', field: 'status', filters: [] },
        {
          kind: 'derived',
          name: 'averageOrderValue',
          uses: [{ alias: 'revenue', measure: 'revenue' }, { alias: 'orders', measure: 'orderCount' }],
          expression: {
            kind: 'binary',
            operator: 'divide',
            left: { kind: 'reference', name: 'revenue' },
            right: {
              kind: 'call',
              function: 'nullIfZero',
              args: [{ kind: 'reference', name: 'orders' }],
            },
          },
        },
      ],
      filters: [{ name: 'status', field: 'status', operators: ['eq'] }],
      relationships: [],
      limits: { maxResultSize: 1_000 },
      endpoint: ENDPOINT,
    }],
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
    // A selection that includes a derived measure is planned as a CTE and run
    // through `rawQuery`, not the table chain.
    rawQuery: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
      sql.push(query);
      return rows as T[];
    },
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

function wire(rows: Record<string, unknown>[]) {
  const { factory, sql } = builderFactory(rows);
  const plane = createDeploymentSemanticDataPlane({
    deployment: contract() as never,
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

  it('answers a call selecting a base and a derived measure together', async () => {
    // The derived measure exists only inside the contract's measure collection;
    // nothing rebuilt it from the authoring package.
    const { plane, sql } = wire([{ status: 'paid', revenue: 10, averageOrderValue: 5 }]);

    const result = await plane.invoke({
      invocation: invocation({
        kind: 'dataset',
        dataset: 'orders',
        dimensions: ['status'],
        measures: ['revenue', 'averageOrderValue'],
      }),
      credentials: 'token',
    });

    expect(result.meta.rowCount).toBe(1);
    expect(Object.keys(result.data[0] as object)).toContain('averageOrderValue');
    // Planned from the contract's own measure collection: the ratio and its
    // zero-denominator guard are in the SQL, not supplied by the caller.
    expect(sql[0]).toContain('NULLIF');
  });

  it('refuses a metric target rather than planning one', async () => {
    const { plane, sql } = wire([{ status: 'paid' }]);

    await expect(plane.invoke({
      invocation: invocation({ kind: 'metric', dataset: 'orders', metric: 'totalRevenue' }),
      credentials: 'token',
    })).rejects.toThrow(DeploymentSemanticInvocationError);
    expect(sql).toHaveLength(0);
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

  it('rejects a forged tenant before it reaches the executor', async () => {
    const { plane, sql } = wire([{ status: 'paid' }]);

    await expect(plane.invoke({
      invocation: { ...invocation({ kind: 'dataset', dataset: 'orders', measures: ['revenue'] }), tenant: 'globex' },
      credentials: 'token',
    })).rejects.toThrow(DeploymentSemanticInvocationError);
    expect(sql).toHaveLength(0);
  });
});
