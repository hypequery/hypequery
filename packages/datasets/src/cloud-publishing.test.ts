import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { belongsTo } from './relationships.js';
import { publishToCloud } from './cloud-publishing.js';
import { measure } from './measure.js';
import { publishDatasets } from './publishing/publisher.js';

const access = { roles: [], scopes: [] };

describe('publishToCloud', () => {
  it('publishes datasets with authenticated endpoints and tenant policy', () => {
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.string(), tenant_id: dimension.string() },
    });

    const contract = publishToCloud({ access, datasets: { orders: Orders } });

    expect(contract).toMatchObject({
      kind: 'hypequery-deployment',
      version: 2,
      datasets: [{
        name: 'orders',
        tenant: { kind: 'required', field: 'tenant_id' },
        endpoint: {
          access: { kind: 'authenticated', roles: [], scopes: [] },
          tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
          path: '/api/analytics/datasets/orders/query',
        },
      }],
    });
    expect(Object.isFrozen(contract.datasets)).toBe(true);
  });

  it('includes relationship targets without exposing their own endpoint', () => {
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: { id: dimension.string() },
    });
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
    });

    const contract = publishToCloud({ access, datasets: { orders: Orders } });

    expect(contract.datasets.map(item => item.name)).toEqual(['customers', 'orders']);
    expect(contract.datasets[0]?.endpoint).toBeUndefined();
    expect(contract.datasets[1]?.endpoint?.tenant).toEqual({ kind: 'not-required' });
  });

  it('rejects an empty registry and conflicting dataset names', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
    });
    expect(() => publishToCloud({ access, datasets: {} })).toThrow('at least one dataset');
    const OtherOrders = dataset('orders', {
      source: 'other_orders',
      dimensions: { id: dimension.string() },
    });
    expect(() => publishToCloud({ access, datasets: { orders: Orders, otherOrders: OtherOrders } }))
      .toThrow('Multiple Dataset definitions');
  });

  it('rejects named metrics rather than silently dropping them', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      measures: { orderCount: measure.count('id') },
    });
    const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });
    const published = publishDatasets().publish(Orders, { metrics: { orderCount } }).build();

    expect(() => publishToCloud({ access, datasets: published })).toThrow('does not support named metrics');
  });

  it('requires explicit access and supports a per-dataset role policy', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
    });
    expect(() => publishToCloud({ datasets: { Orders } } as never))
      .toThrow('explicit authenticated access policy');

    const contract = publishToCloud({
      datasets: { Orders },
      access,
      datasetAccess: { orders: { roles: ['analyst'], scopes: ['orders:read'] } },
    });
    expect(contract.datasets[0]?.endpoint?.access).toEqual({
      kind: 'authenticated', roles: ['analyst'], scopes: ['orders:read'],
    });
    expect(() => publishToCloud({
      datasets: { Orders }, access, datasetAccess: { typo: { roles: [], scopes: [] } },
    })).toThrow('unpublished dataset');
  });

  it('uses an explicit endpoint policy as given, in place of the derived one', () => {
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.string(), tenant_id: dimension.string() },
    });
    const endpoint = {
      access: { kind: 'authenticated' as const, roles: ['analyst'], scopes: [] },
      tenant: { kind: 'required' as const, mode: 'manual' as const, column: 'tenant_id' },
      cacheTtlMs: 30_000,
      path: '/api/analytics/datasets/orders/query',
    };

    const contract = publishToCloud({ access, datasets: { orders: Orders }, endpoints: { orders: endpoint } });

    expect(contract.datasets[0]?.endpoint).toEqual(endpoint);
    expect(() => publishToCloud({ access, datasets: { orders: Orders }, endpoints: { other: endpoint } }))
      .toThrow('unpublished dataset: "other"');
  });

  it('publishes supporting datasets without an endpoint', () => {
    const Orders = dataset('orders', { source: 'orders', dimensions: { id: dimension.string() } });
    const Plans = dataset('plans', { source: 'plans', dimensions: { id: dimension.string() } });

    const contract = publishToCloud({ access, datasets: { orders: Orders }, supporting: { plans: Plans } });

    expect(contract.datasets.map(item => [item.name, item.endpoint === undefined])).toEqual([
      ['orders', false],
      ['plans', true],
    ]);
    expect(() => publishToCloud({ access, datasets: { orders: Orders }, supporting: { orders: Orders } }))
      .toThrow("can't be both published and supporting");
  });
});
