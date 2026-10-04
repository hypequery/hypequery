import { describe, expect, it, vi } from 'vitest';
import { belongsTo, dataset, dimension, hasMany, hasOne, measure, serializeSemanticContract } from '@hypequery/datasets';
import { createAPI } from '../../server/create-api.js';
import { createBearerTokenStrategy } from '../../auth.js';
import { publicSemanticContract } from './utils/public-contract.js';

const orders = dataset('orders', {
  source: 'PHYSICAL_SOURCE', tenantKey: 'TENANT_POLICY',
  dimensions: { country: dimension.string({ column: 'PHYSICAL_COLUMN' }) },
  measures: { total: measure.count('PHYSICAL_ID') },
});

describe('logical discovery and public contract', () => {
  it('advertises queryable relationship measures without exposing physical definitions', async () => {
    const target = dataset('target', {
      source: 'PHYSICAL_TARGET', tenantKey: 'TENANT_POLICY',
      dimensions: { id: dimension.number({ column: 'PHYSICAL_ID' }) },
      measures: {
        unique: measure.countDistinct('PHYSICAL_ID'),
        estimated: measure.approxCountDistinct('PHYSICAL_ID'),
        total: measure.count('PHYSICAL_ID'),
      },
    });
    const source = dataset('source', {
      source: 'PHYSICAL_SOURCE',
      dimensions: { id: dimension.number({ column: 'PHYSICAL_ID' }) },
      relationships: {
        target: belongsTo(() => target, { from: 'PHYSICAL_FK', to: 'PHYSICAL_ID' }),
        profile: hasOne(() => target, { from: 'PHYSICAL_ID', to: 'PHYSICAL_ID' }),
        many: hasMany(() => target, { from: 'PHYSICAL_ID', to: 'PHYSICAL_ID' }),
      },
    });
    const api = createAPI({
      basePath: '', datasets: { publicSource: source }, discovery: { requiresAuth: false },
      queryBuilder: { table: vi.fn(), rawQuery: vi.fn() },
    });
    const response = await api.handler({ method: 'GET', path: '/discovery', query: {}, headers: {} });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ datasets: [{
      name: 'publicSource',
      measures: [
        { name: 'profile.estimated', approximate: true },
        { name: 'profile.total' }, { name: 'profile.unique' },
        { name: 'target.estimated', approximate: true }, { name: 'target.unique' },
      ],
    }] });
    for (const marker of ['PHYSICAL_', 'TENANT_POLICY', 'requiresTenant', 'many.total', 'target.total']) {
      expect(JSON.stringify(response.body)).not.toContain(marker);
    }
  });

  it('retains logical window and shift requirements in the public contract', () => {
    const timed = dataset('timed', {
      source: 'PHYSICAL_SOURCE', tenantKey: 'TENANT_POLICY', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp({ column: 'PHYSICAL_TIME' }) },
      measures: {
        total: measure.count('PHYSICAL_ID'),
        trailing: measure.trailing('total', { amount: 7, unit: 'day' }),
        shifted: measure.shift('total', { amount: 1, unit: 'day' }),
        monthly: measure.toDate('total', 'month'),
        cumulative: measure.cumulative('total'),
      },
    });
    const contract = serializeSemanticContract({ timed });
    const projection = publicSemanticContract(contract);
    expect(projection.datasets.timed).toMatchObject({ measures: {
      trailing: { kind: 'window', measure: 'total', trailing: { amount: 7, unit: 'day' }, requiresTimeRange: true },
      shifted: { kind: 'shift', measure: 'total', interval: { amount: 1, unit: 'day' }, requiresTimeRange: true },
      monthly: { kind: 'window', measure: 'total', toDate: 'month', requiresTimeRange: true },
      cumulative: { kind: 'window', measure: 'total', cumulative: true, requiresTimeRange: true },
    } });
    for (const name of ['trailing', 'shifted', 'monthly', 'cumulative']) {
      expect(contract.datasets.timed.measures[name].supportedGrains?.length).toBeGreaterThan(0);
      expect(projection.datasets.timed).toMatchObject({ measures: {
        [name]: { supportedGrains: contract.datasets.timed.measures[name].supportedGrains },
      } });
    }
    expect(JSON.stringify(projection)).not.toMatch(/PHYSICAL_|TENANT_POLICY/);
  });

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
