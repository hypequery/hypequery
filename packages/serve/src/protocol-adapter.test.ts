import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dataset, dimension, measure } from '@hypequery/datasets';
import {
  buildProtocolDeploymentContract,
  createAPI,
  ProtocolSchemaAdapterError,
  zodToProtocolSchema,
} from './index.js';
import type { QueryBuilderFactoryInput } from '@hypequery/datasets';
import type { CloudCompatibilityDiagnostic } from './cloud-compatibility.js';

/** Contract building never executes a query, so a stub factory is enough. */
const stubQueryBuilder = (() => ({})) as unknown as QueryBuilderFactoryInput;

describe('Serve protocol adapter', () => {
  it('exposes deployment contract generation on created APIs', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
    });
    const api = createAPI({
      queryBuilder: stubQueryBuilder,
      datasets: { orders: Orders },
      queries: {
        greeting: {
          input: z.object({ name: z.string() }),
          output: z.string(),
          query: async ({ input }) => `Hello ${input.name}`,
        },
      },
    });

    const contract = api.deploymentContract();

    expect(contract.version).toBe(2);
    expect(contract.datasets.map(entry => entry.name)).toEqual(['orders']);
    expect(contract.queries).toBeUndefined();
    expect(contract.artifacts).toBeUndefined();
  });

  it('carries dataset endpoints and drops named queries entirely', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.string() },
    });
    const contract = buildProtocolDeploymentContract({
      basePath: '/analytics',
      tenant: {
        extract: auth => auth.tenantId,
        required: true,
        mode: 'auto-inject',
        column: 'tenant_id',
      },
      datasets: { orders: Orders },
      queries: {
        greeting: {
          method: 'POST',
          inputSchema: z.object({ name: z.string().min(1) }).strict(),
          outputSchema: z.object({ message: z.string() }),
          query: async ({ input }) => ({ message: input.name }),
          requiredScopes: ['read:greeting'],
          tags: ['example'],
        },
      },
    });

    expect(contract.datasets[0]?.endpoint).toMatchObject({
      access: { kind: 'public' },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      maxLimit: 1000,
      path: '/analytics/datasets/orders/query',
    });
    // The serialized contract is the gate: no field of it names the query.
    expect(JSON.stringify(contract)).not.toContain('greeting');
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('reports named queries and standalone metrics as local-only', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      measures: { count: measure.count('id') },
    });
    const Shipments = dataset('shipments', {
      source: 'shipments',
      dimensions: { id: dimension.string() },
      measures: { count: measure.count('id') },
    });
    const diagnostics: CloudCompatibilityDiagnostic[] = [];
    buildProtocolDeploymentContract({
      datasets: { orders: Orders },
      metrics: { shipped: { metric: Shipments.metric('shipped', { measure: 'count' }) } },
      queries: {
        greeting: {
          inputSchema: z.void(),
          outputSchema: z.string(),
          query: async () => 'ok',
        },
      },
    }, { onCloudDiagnostic: diagnostic => diagnostics.push(diagnostic) });

    expect(diagnostics.map(entry => [entry.code, entry.subject])).toEqual([
      ['HQ_CLOUD_LOCAL_ONLY_QUERY', 'queries.greeting'],
      ['HQ_CLOUD_LOCAL_ONLY_METRIC', 'metrics.shipped'],
      ['HQ_CLOUD_LOCAL_ONLY_DATASET', 'datasets.shipments'],
    ]);
    expect(diagnostics.every(entry => entry.severity === 'warning')).toBe(true);
  });

  it('does not block a build over a local-only endpoint it cannot deploy', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.string() },
      measures: { count: measure.count('id') },
    });
    // No tenantKey, under a config that requires a tenant: a blocking finding
    // for a deployed endpoint, but this metric is never deployed.
    const Legacy = dataset('legacy', {
      source: 'legacy',
      dimensions: { id: dimension.string() },
      measures: { count: measure.count('id') },
    });

    expect(() => buildProtocolDeploymentContract({
      tenant: { extract: auth => auth.tenantId, required: true, column: 'tenant_id' },
      datasets: { orders: Orders },
      metrics: { legacy: { metric: Legacy.metric('legacy', { measure: 'count' }) } },
    })).not.toThrow();
  });

  it('fails closed for Zod behavior the portable schema cannot preserve', () => {
    expect(() => zodToProtocolSchema(z.string().email()))
      .toThrow(ProtocolSchemaAdapterError);
  });

  it('preserves role enforcement even when auth is explicitly null', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
    });
    const contract = buildProtocolDeploymentContract({
      datasets: {
        orders: { dataset: Orders, auth: null, requiredRoles: ['admin'] },
      },
    });

    expect(contract.datasets[0]?.endpoint?.access).toEqual({
      kind: 'authenticated',
      roles: ['admin'],
      scopes: [],
    });
  });

  it('preserves global auth for semantic endpoints with no local strategy', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
    });
    const contract = buildProtocolDeploymentContract({
      auth: async () => ({ userId: 'user_1' }),
      datasets: {
        orders: { dataset: Orders, auth: null },
      },
    });

    expect(contract.datasets[0]?.endpoint?.access).toEqual({
      kind: 'authenticated',
      roles: [],
      scopes: [],
    });
  });

  it('uses requiresAuth false for explicitly public semantic endpoints', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      measures: { count: measure.count('id') },
    });
    const contract = buildProtocolDeploymentContract({
      auth: async () => ({ userId: 'user_1' }),
      datasets: {
        orders: { dataset: Orders, requiresAuth: false },
      },
    });

    expect(contract.datasets[0]?.endpoint?.access).toEqual({ kind: 'public' });
    expect(contract.datasets[0]?.metrics).toBeUndefined();
  });

  it('rejects typed object catchalls that the protocol cannot represent', () => {
    expect(() => zodToProtocolSchema(z.object({ id: z.string() }).catchall(z.number())))
      .toThrow(ProtocolSchemaAdapterError);
  });

  it('rejects constrained record keys that the protocol cannot represent', () => {
    expect(() => zodToProtocolSchema(z.record(z.enum(['a', 'b']), z.string())))
      .toThrow(ProtocolSchemaAdapterError);
    expect(zodToProtocolSchema(z.record(z.string()))).toMatchObject({
      kind: 'record',
      values: { kind: 'string' },
    });
  });

  it('excludes reverse mappings from numeric native enums', () => {
    enum NumericEnum {
      Alpha,
      Beta,
    }

    expect(zodToProtocolSchema(z.nativeEnum(NumericEnum))).toEqual({
      kind: 'enum',
      values: [0, 1],
    });
  });

  it('preserves discriminator properties when lowering discriminated unions', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('created'), id: z.string() }),
      z.object({ type: z.literal('deleted'), reason: z.string() }),
    ]);

    expect(zodToProtocolSchema(schema)).toMatchObject({
      kind: 'union',
      variants: [
        {
          kind: 'object',
          properties: { type: { kind: 'literal', value: 'created' } },
          required: ['type', 'id'],
        },
        {
          kind: 'object',
          properties: { type: { kind: 'literal', value: 'deleted' } },
          required: ['type', 'reason'],
        },
      ],
    });
  });

  it('unwraps readonly Zod schemas', () => {
    expect(zodToProtocolSchema(z.string().readonly())).toEqual({ kind: 'string' });
  });
});
