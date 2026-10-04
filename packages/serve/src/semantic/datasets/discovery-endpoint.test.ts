import { describe, expect, it, vi } from 'vitest';
import { dataset, dimension, measure, serializeSemanticContract } from '@hypequery/datasets';
import { createAPI } from '../../server/create-api.js';
import { createBearerTokenStrategy } from '../../auth.js';
import { publicSemanticContract } from './utils/public-contract.js';

const orders = dataset('orders', {
  source: 'PHYSICAL_SOURCE', tenantKey: 'TENANT_POLICY',
  dimensions: { country: dimension.string({ column: 'PHYSICAL_COLUMN' }) },
  measures: { total: measure.count('PHYSICAL_ID') },
});

describe('logical discovery and public contract', () => {
  it('keeps physical fields out while retaining definition identity', () => {
    const contract = serializeSemanticContract({ orders });
    const projection = publicSemanticContract(contract);
    expect(projection.contentHash).toBe(contract.contentHash);
    for (const marker of ['PHYSICAL_', 'TENANT_POLICY', 'requiresTenant']) {
      expect(JSON.stringify(projection)).not.toContain(marker);
    }
  });

  it('authenticates discovery by default and supports explicit public access', async () => {
    for (const requiresAuth of [true, false]) {
      const api = createAPI({
        basePath: '', datasets: { orders },
        auth: createBearerTokenStrategy({ validate: token => ({ userId: token }) }),
        discovery: { requiresAuth },
        queryBuilder: { table: vi.fn(), rawQuery: vi.fn() },
      });
      const response = await api.handler({ method: 'GET', path: '/discovery', query: {}, headers: {} });
      expect(response.status).toBe(requiresAuth ? 401 : 200);
      if (!requiresAuth) expect(JSON.stringify(response.body)).not.toContain('PHYSICAL_');
    }
  });

  it.each([true, false])('enforces discovery roles and scopes with requiresAuth=%s', async requiresAuth => {
    const api = createAPI({
      basePath: '', datasets: { orders },
      auth: createBearerTokenStrategy({ validate: token => ({
        userId: token,
        roles: token === 'allowed' || token === 'role-only' ? ['analyst'] : [],
        scopes: token === 'allowed' || token === 'scope-only' ? ['catalog:read'] : [],
      }) }),
      discovery: { requiresAuth, requiredRoles: ['analyst'], requiredScopes: ['catalog:read'] },
      queryBuilder: { table: vi.fn(), rawQuery: vi.fn() },
    });
    for (const [token, status] of [
      [undefined, 401], ['denied', 403], ['role-only', 403], ['scope-only', 403], ['allowed', 200],
    ] as const) {
      const response = await api.handler({
        method: 'GET', path: '/discovery', query: {},
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      expect(response.status).toBe(status);
    }
  });
});
