import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';

import {
  analyzeCloudCompatibility,
  type CloudCompatibilityCode,
} from './cloud-compatibility.js';

const tenantScoped = dataset('orders', {
  source: 'orders',
  tenantKey: 'organization_id',
  dimensions: { id: dimension.string({ column: 'id' }) },
  measures: { orderCount: measure.count('id') },
});

const shared = dataset('regions', {
  source: 'regions',
  dimensions: { id: dimension.string({ column: 'id' }) },
  measures: { regionCount: measure.count('id') },
});

function codes(config: Parameters<typeof analyzeCloudCompatibility>[0]) {
  return analyzeCloudCompatibility(config).map(d => d.code);
}

function severityOf(
  config: Parameters<typeof analyzeCloudCompatibility>[0],
  code: CloudCompatibilityCode,
) {
  return analyzeCloudCompatibility(config).find(d => d.code === code)?.severity;
}

describe('analyzeCloudCompatibility', () => {
  it('passes a config that carries entirely into the contract', () => {
    expect(
      codes({ datasets: { orders: tenantScoped } } as never),
    ).toEqual([]);
  });

  it('reports a tenant requirement the dataset cannot enforce', () => {
    // The planner resolves the tenant column from the dataset's tenantKey. With
    // no tenantKey and no customer code in Cloud, this endpoint would demand a
    // tenant and return every tenant's rows.
    const config = {
      datasets: { regions: shared },
      tenant: { extract: (auth: { tenantId?: string }) => auth.tenantId, required: true },
    } as never;

    expect(codes(config)).toContain('HQ_CLOUD_TENANT_NOT_ENFORCEABLE');
    expect(severityOf(config, 'HQ_CLOUD_TENANT_NOT_ENFORCEABLE')).toBe('error');
  });

  it('accepts a shared dataset when tenancy is explicitly not required', () => {
    expect(
      codes({
        datasets: { regions: shared },
        tenant: { extract: () => null, required: false },
      } as never),
    ).not.toContain('HQ_CLOUD_TENANT_NOT_ENFORCEABLE');
  });

  it('does not fault a tenant-scoped dataset under a tenant requirement', () => {
    expect(
      codes({
        datasets: { orders: tenantScoped },
        tenant: { extract: (auth: { tenantId?: string }) => auth.tenantId },
      } as never),
    ).not.toContain('HQ_CLOUD_TENANT_NOT_ENFORCEABLE');
  });

  it('blocks on global middleware, which never runs in Cloud', () => {
    const config = {
      datasets: { orders: tenantScoped },
      middlewares: [async () => undefined],
    } as never;

    expect(codes(config)).toContain('HQ_CLOUD_MIDDLEWARE_DROPPED');
    expect(severityOf(config, 'HQ_CLOUD_MIDDLEWARE_DROPPED')).toBe('error');
  });

  it('blocks on per-query middleware and names the query', () => {
    const diagnostics = analyzeCloudCompatibility({
      queries: { revenue: { middlewares: [async () => undefined] } },
    } as never);

    const found = diagnostics.find(d => d.code === 'HQ_CLOUD_MIDDLEWARE_DROPPED');
    expect(found?.severity).toBe('error');
    expect(found?.subject).toBe('queries.revenue');
  });

  it('warns rather than blocks on hooks and context factories', () => {
    const config = {
      datasets: { orders: tenantScoped },
      hooks: { onRequest: () => undefined },
      context: () => ({}),
    } as never;

    expect(severityOf(config, 'HQ_CLOUD_HOOKS_DROPPED')).toBe('warning');
    expect(severityOf(config, 'HQ_CLOUD_CONTEXT_DROPPED')).toBe('warning');
  });

  it('warns when auth is required but no roles or scopes are declared', () => {
    // The strategy is not carried, so Cloud would accept any valid credential
    // even if the local strategy rejects most callers.
    const config = {
      datasets: { orders: tenantScoped },
      auth: async () => ({ userId: 'u1' }),
    } as never;

    expect(severityOf(config, 'HQ_CLOUD_AUTH_WITHOUT_ROLES')).toBe('warning');
  });

  it('stays quiet when the endpoint declares roles Cloud can enforce', () => {
    expect(
      codes({
        datasets: { orders: { dataset: tenantScoped, requiredRoles: ['analyst'] } },
        auth: async () => ({ userId: 'u1' }),
      } as never),
    ).not.toContain('HQ_CLOUD_AUTH_WITHOUT_ROLES');
  });

  it('explains the remedy for every diagnostic it reports', () => {
    const diagnostics = analyzeCloudCompatibility({
      datasets: { regions: shared },
      tenant: { extract: () => null },
      middlewares: [async () => undefined],
      hooks: { onRequest: () => undefined },
    } as never);

    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.remedy.length).toBeGreaterThan(0);
      expect(diagnostic.subject.length).toBeGreaterThan(0);
    }
  });
});
