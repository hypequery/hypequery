/**
 * RFC 0030: query features are gated by semantic invocation version only. A
 * data plane runs invocation 2 against a contract 2 release; the contract
 * version limits what a dataset can declare, not what a query may ask for.
 */

import { belongsTo, buildProtocolDeploymentContract, createPortableSemanticExecutor, dataset, dimension, measure } from '@hypequery/datasets';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { createDeploymentSemanticDataPlane, DeploymentSemanticInvocationError } from './semantic-data-plane.js';

const ENDPOINT = {
  access: { kind: 'public' },
  tenant: { kind: 'not-required' },
  maxLimit: 500,
} as const;

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), region: dimension.string() },
  measures: { customerCount: measure.countDistinct('id') },
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: {
    id: dimension.string(), customerId: dimension.string(), status: dimension.string(),
    amount: dimension.number(), createdAt: dimension.timestamp(),
  },
  measures: { revenue: measure.sum('amount'), orders: measure.count('id') },
  relationships: { customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }) },
});

function contract2() {
  const contract = buildProtocolDeploymentContract([Orders, Customers], {
    endpoints: { orders: ENDPOINT, customers: ENDPOINT },
  });
  expect(contract.version).toBe(2);
  return contract;
}

function recordingFactory() {
  const sql: string[] = [];
  const factory: QueryBuilderFactoryLike = {
    table(table: string) {
      const parts: string[] = [];
      const render = () => `SELECT ${parts.join(' ')} FROM ${table}`;
      const chain = new Proxy({} as QueryBuilderLike, {
        get: (_target, property: string) => {
          if (property === 'execute') return async () => { sql.push(render()); return []; };
          if (property === 'toSQLWithParams') return () => ({ sql: render(), parameters: [] });
          if (property === 'toSQL') return () => render();
          return (...args: unknown[]) => {
            parts.push(`${property}(${args.filter(a => a !== undefined).map(String).join(',')})`);
            return chain;
          };
        },
      });
      return chain;
    },
    rawQuery: async <T = Record<string, unknown>>(query: string): Promise<T[]> => {
      sql.push(query);
      return [] as T[];
    },
  };
  return { factory, sql };
}

function wire() {
  const { factory, sql } = recordingFactory();
  const plane = createDeploymentSemanticDataPlane({
    deployment: contract2(),
    activationRevision: 'c'.repeat(64),
    execute: createPortableSemanticExecutor({ queryBuilder: factory }) as never,
  });
  const invoke = (operation: Record<string, unknown>) => plane.invoke({
    invocation: {
      kind: 'hypequery-semantic-invocation', version: 2,
      target: { project: 'acme', environment: 'production' },
      operation: { kind: 'dataset', dataset: 'orders', ...operation },
    },
  });
  return { invoke, sql };
}

describe('semantic invocation 2 against a contract 2 release (RFC 0030)', () => {
  it.each([
    ['a sub-day grain', { measures: ['revenue'], by: 'hour' }, 'toStartOfHour'],
    ['a calculation', { dimensions: ['status'], measures: ['revenue'], calculations: [{ name: 'share', share: { measure: 'revenue' } }] }, 'OVER ()'],
    ['limitBy', { dimensions: ['status', 'customerId'], measures: ['revenue'], orderBy: [{ field: 'revenue', direction: 'desc' }], limitBy: { n: 2, by: ['status'] } }, 'LIMIT 2 BY'],
    ['other', { dimensions: ['status'], measures: ['revenue'], other: { dimension: 'status', n: 3, measure: 'revenue' } }, '_hq_other_top'],
  ] as const)('runs %s', async (_name, operation, marker) => {
    const { invoke, sql } = wire();
    await invoke(operation);
    expect(sql.join('\n')).toContain(marker);
  });

  // Not a contract 2 limit: the data plane resolves only a dataset's own
  // measures under every contract version, so this reads as unknown on 3 too.
  it('refuses a relationship measure as unknown, as it does on contract 3', async () => {
    const { invoke, sql } = wire();
    const error = await invoke({ dimensions: ['status'], measures: ['customer.customerCount'] }).catch(caught => caught);
    expect([error.category, error.message]).toEqual(['input-invalid', 'Unknown measure "customer.customerCount".']);
    expect(sql).toHaveLength(0);
  });

  it('refuses a segment as unknown, because contract 2 cannot declare one', async () => {
    const { invoke, sql } = wire();
    const error = await invoke({ measures: ['revenue'], segments: ['paid'] }).catch(caught => caught);
    expect(error).toBeInstanceOf(DeploymentSemanticInvocationError);
    expect([error.category, error.code, error.path]).toEqual(['input-invalid', 'HQ_SEMANTIC_INPUT_INVALID', '$.operation.segments[0]']);
    expect(error.message).toBe('Unknown segment "paid".');
    expect(sql).toHaveLength(0);
  });
});
