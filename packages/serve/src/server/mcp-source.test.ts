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

  it('omits auth when the application configures none', () => {
    const source = readServeMcpSource(createAPI({ datasets: { orders: Orders }, queryBuilder }));
    expect(source).toBeDefined();
    expect(source?.auth).toBeUndefined();
  });
});
