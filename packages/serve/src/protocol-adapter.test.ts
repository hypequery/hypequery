import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dataset, dimension, measure } from '@hypequery/datasets';
import {
  buildProtocolDeploymentContract,
  ProtocolSchemaAdapterError,
  zodToProtocolSchema,
} from './index.js';

const ARTIFACT_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Serve protocol adapter', () => {
  it('converts Serve queries and Dataset endpoints into one deployment contract', () => {
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
          inputSchema: z.object({
            name: z.string().min(1),
            loud: z.boolean().optional(),
          }).strict(),
          outputSchema: z.object({ message: z.string() }),
          query: async ({ input }) => ({ message: input.name }),
          requiredScopes: ['read:greeting'],
          tags: ['example'],
        },
      },
    }, {
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
      },
    });

    expect(contract.datasets[0]?.endpoint).toMatchObject({
      access: { kind: 'public' },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
      maxLimit: 1000,
      path: '/analytics/datasets/orders/query',
    });
    expect(contract.queries[0]).toMatchObject({
      name: 'greeting',
      input: {
        kind: 'object',
        required: ['name'],
        unknownProperties: 'reject',
      },
      implementation: {
        kind: 'runtime-reference',
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
        entrypoint: 'queries.greeting',
      },
      endpoint: {
        access: { kind: 'authenticated', roles: [], scopes: ['read:greeting'] },
        tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
        method: 'POST',
        path: '/analytics/queries/greeting',
      },
    });
    expect(contract.artifacts).toEqual([{ runtime: 'node', artifactSha256: ARTIFACT_SHA }]);
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('fails closed for Zod behavior the portable schema cannot preserve', () => {
    expect(() => zodToProtocolSchema(z.string().email()))
      .toThrow(ProtocolSchemaAdapterError);
  });

  it('preserves role enforcement even when auth is explicitly null', () => {
    const contract = buildProtocolDeploymentContract({
      queries: {
        guarded: {
          inputSchema: z.void(),
          outputSchema: z.string(),
          query: async () => 'ok',
          auth: null,
          requiredRoles: ['admin'],
        },
      },
    }, {
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
      },
    });

    expect(contract.queries[0]?.endpoint.access).toEqual({
      kind: 'authenticated',
      roles: ['admin'],
      scopes: [],
    });
  });

  it('preserves global auth for named queries with no local strategy', () => {
    const contract = buildProtocolDeploymentContract({
      auth: async () => ({ userId: 'user_1' }),
      queries: {
        guarded: {
          inputSchema: z.void(),
          outputSchema: z.string(),
          query: async () => 'ok',
          auth: null,
        },
      },
    }, {
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
      },
    });

    expect(contract.queries[0]?.endpoint.access.kind).toBe('authenticated');
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
    const revenue = Orders.metric('revenue', {
      measure: 'count',
    });
    const contract = buildProtocolDeploymentContract({
      auth: async () => ({ userId: 'user_1' }),
      datasets: {
        orders: { dataset: Orders, requiresAuth: false },
      },
      metrics: {
        revenue: { metric: revenue, requiresAuth: false },
      },
    });

    expect(contract.datasets[0]?.endpoint?.access).toEqual({ kind: 'public' });
    expect(contract.datasets[0]?.metrics[0]?.endpoint.access).toEqual({ kind: 'public' });
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
