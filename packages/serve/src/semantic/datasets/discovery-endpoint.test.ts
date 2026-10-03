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
});
