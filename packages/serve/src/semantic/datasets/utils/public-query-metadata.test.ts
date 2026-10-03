import { describe, expect, it, vi } from 'vitest';
import { authorizedQueryDiagnostics, publicQueryMetadata } from './public-query-metadata.js';
import { publicSemanticContract } from './public-contract.js';
import { createAPI } from '../../../server/create-api.js';
import { createBearerTokenStrategy } from '../../../auth.js';
import { dataset, dimension, measure, serializeSemanticContract } from '@hypequery/datasets';
import { semanticFixtureBuilder } from './semantic-fixture-builder.js';

describe('public metadata and privileged diagnostics', () => {
  it('keeps physical fields out of the legacy public contract', () => {
    const model = dataset('orders', {
      source: 'PHYSICAL_SOURCE', tenantKey: 'TENANT_POLICY',
      dimensions: { country: dimension.string({ column: 'PHYSICAL_COLUMN', sql: 'SECRET_SQL' }) },
      measures: { total: measure.count('PHYSICAL_ID') },
    });
    const contract = serializeSemanticContract({ orders: model });
    const projection = publicSemanticContract(contract);
    expect(projection.contentHash).toBe(contract.contentHash);
    for (const marker of ['PHYSICAL_', 'TENANT_POLICY', 'SECRET_SQL', 'requiresTenant']) {
      expect(JSON.stringify(projection)).not.toContain(marker);
    }
  });

  it('projects nested metadata instead of forwarding unknown fields', () => {
    const input = {
      timingMs: 2, rowCount: 1, sql: 'SECRET', tenant: 'SECRET',
      pagination: { limit: 1, offset: 0, hasMore: false, tenant: 'SECRET' },
      cache: { hit: false, sql: 'SECRET' },
    };
    expect(publicQueryMetadata(input)).toEqual({ timingMs: 2, rowCount: 1,
      pagination: { limit: 1, offset: 0, hasMore: false }, cache: { hit: false } });
  });

  it('requires authentication and explicit permission before auditing diagnostics', async () => {
    const audit = vi.fn();
    const access = { authorize: vi.fn(() => false), audit };
    expect(await authorizedQueryDiagnostics(access, null, { sql: 'SECRET' })).toBeUndefined();
    expect(access.authorize).not.toHaveBeenCalled();
    expect(await authorizedQueryDiagnostics(access, { userId: 'reader' }, { sql: 'SECRET' })).toBeUndefined();
    expect(audit).not.toHaveBeenCalled();
    access.authorize.mockReturnValue(true);
    expect(await authorizedQueryDiagnostics(access, { userId: 'admin' }, { sql: 'SQL' })).toEqual({ sql: 'SQL' });
    expect(audit).toHaveBeenCalledOnce();
  });

  it('refuses diagnostics if the audit fails', async () => {
    const access = { authorize: () => true, audit: () => { throw new Error('audit failed'); } };
    await expect(authorizedQueryDiagnostics(access, { userId: 'admin' }, { sql: 'SECRET' })).rejects.toThrow('audit failed');
  });

  it.each(['dataset', 'metric'] as const)('returns %s diagnostics separately and audits only an authorized request', async kind => {
    const model = dataset('orders', {
      source: 'private_orders', dimensions: { country: dimension.string() },
      measures: { total: measure.count('id') },
    });
    const audit = vi.fn();
    const diagnostics = { authorize: (auth: { userId?: string }) => auth.userId === 'admin', audit };
    const api = createAPI({
      basePath: '',
      auth: createBearerTokenStrategy({ validate: token => ({ userId: token }) }),
      queryBuilder: semanticFixtureBuilder([{ total: 10 }]),
      ...(kind === 'dataset' ? { datasets: { orders: { dataset: model, diagnostics } } }
        : { metrics: { total: { metric: model.metric('total', { measure: 'total' }), diagnostics } } }),
    });
    for (const user of ['reader', 'admin']) {
      const response = await api.handler({
        method: 'POST', path: kind === 'dataset' ? '/datasets/orders/query' : '/metrics/total',
        query: {}, body: { includeMeta: true },
        headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json' },
      });
      expect(response.status).toBe(200);
      const body = response.body as { meta: { sql?: string }; diagnostics?: { sql?: string } };
      expect(body.meta.sql).toBeUndefined();
      if (user === 'admin') expect(body.diagnostics?.sql).toContain('private_orders');
      else expect(body.diagnostics).toBeUndefined();
    }
    expect(audit).toHaveBeenCalledOnce();
  });
});
