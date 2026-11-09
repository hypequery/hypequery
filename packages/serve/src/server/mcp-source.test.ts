import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure, type QueryBuilderFactoryLike } from '@hypequery/datasets';
import { createAPI } from './create-api.js';
import { readServeMcpSource } from './mcp-source.js';
import type { AuthContext, AuthStrategy } from '../types.js';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'org_id',
  dimensions: { status: dimension.string() },
  measures: { revenue: measure.sum('amount') },
});

// Never executed: these tests only read the MCP source seam.
const queryBuilder = { table: () => ({}), rawQuery: async () => [] } as unknown as QueryBuilderFactoryLike;

describe('ServeMcpSource', () => {
  it('carries the application auth strategies and tenant extraction for hypequery mcp --http', async () => {
    const strategy: AuthStrategy<AuthContext> = async () => ({ userId: 'u1', org: 'acme' });
    const api = createAPI({
      datasets: { orders: Orders },
      queryBuilder,
      auth: strategy,
      tenant: { extract: auth => auth.org as string },
    });
    const source = readServeMcpSource(api);
    expect(source?.auth?.strategies).toEqual([strategy]);
    expect(source?.auth?.tenant?.extract({ userId: 'u1', org: 'acme' })).toBe('acme');
    expect(Object.isFrozen(source?.auth)).toBe(true);
  });

  it('lists the datasets and metrics whose own rules the MCP transport would skip', () => {
    const middleware = async (_ctx: unknown, next: () => Promise<unknown>) => next();
    const api = createAPI({
      datasets: {
        orders: Orders,
        finance: { dataset: Orders, requiredRoles: ['finance'] },
        scoped: { dataset: Orders, requiredScopes: ['analytics:read'] },
        local: { dataset: Orders, auth: (async () => ({ userId: 'u' })) as AuthStrategy<AuthContext> },
        guarded: { dataset: Orders, middlewares: [middleware as never] },
        retenanted: { dataset: Orders, tenant: { required: false } },
        // Not access rules: a cache TTL, a result ceiling and `requiresAuth: false`.
        tuned: { dataset: Orders, cache: 60, maxLimit: 10, requiresAuth: false },
      },
      metrics: {
        revenue: { metric: Orders.metric('revenue', { measure: 'revenue' }), requiredRoles: ['finance'] },
        plain: Orders.metric('plain', { measure: 'revenue' }),
      },
      queryBuilder,
    });
    const restricted = readServeMcpSource(api)?.restricted;
    expect(restricted).toEqual([
      { kind: 'dataset', name: 'finance', rules: ['requiredRoles'] },
      { kind: 'dataset', name: 'scoped', rules: ['requiredScopes'] },
      { kind: 'dataset', name: 'local', rules: ['auth'] },
      { kind: 'dataset', name: 'guarded', rules: ['middlewares'] },
      { kind: 'dataset', name: 'retenanted', rules: ['tenant'] },
      { kind: 'metric', name: 'revenue', rules: ['requiredRoles'] },
    ]);
    expect(Object.isFrozen(restricted)).toBe(true);
  });

  it('omits auth when the application configures none', () => {
    const source = readServeMcpSource(createAPI({ datasets: { orders: Orders }, queryBuilder }));
    expect(source).toBeDefined();
    expect(source?.auth).toBeUndefined();
    expect(source?.restricted).toBeUndefined();
  });
});
