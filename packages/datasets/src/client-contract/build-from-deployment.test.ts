import { decodeProtocolClientContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, divide, eq, measure, nullIfZero, publishToCloud } from '../index.js';
import { buildClientContract } from './build-from-deployment.js';

const access = { roles: [], scopes: [] };
const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), country: dimension.string() },
  filters: { country: { __type: 'filter_definition', field: 'country', operators: ['eq'] } },
});
const Orders = dataset('orders', {
  source: 'orders',
  description: 'One row per order.',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    tenant: dimension.string({ column: 'tenant_id' }),
    status: dimension.string({ label: '  Order   status ' }),
    paid: dimension.boolean(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { description: 'Gross revenue' }),
    orders: measure.count('status'),
    latestStatus: measure.max('status'),
    average: measure.derived({
      uses: { revenue: 'revenue', orders: 'orders' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
    domesticRevenue: measure.sum('amount', { filters: [eq('customer.country', 'US')] }),
  },
  filters: {
    tenant: { __type: 'filter_definition', field: 'tenant', operators: ['eq', 'in'] },
    status: { __type: 'filter_definition', field: 'status', operators: ['in', 'eq', 'like'] },
    paid: { __type: 'filter_definition', field: 'paid', operators: ['eq', 'gt', 'isNull'] },
    amount: { __type: 'filter_definition', field: 'amount', operators: ['gte', 'like'] },
  },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
  limits: { maxResultSize: 500, maxMeasures: 10 },
});
const deployment = publishToCloud({ access, datasets: { orders: Orders } });

describe('buildClientContract', () => {
  it('advertises each published dataset with typed fields, routes and hashes', () => {
    const { contract } = buildClientContract(deployment);
    expect(contract).toMatchObject({ kind: 'hypequery-client-contract', version: 1, view: 'build' });
    // The relationship target has no endpoint of its own.
    expect(contract.endpoints.map(endpoint => endpoint.id)).toEqual(['orders']);
    const [orders] = contract.endpoints;
    expect(orders).toMatchObject({
      kind: 'dataset',
      dataset: 'orders',
      path: '/api/analytics/datasets/orders/query',
      metadata: true,
      time: { grains: ['day', 'month', 'quarter', 'week', 'year'], defaultTimezone: 'UTC', timezone: true },
      limits: { defaultLimit: 500, maxLimit: 500, maxMeasures: 10, maxDimensions: 100 },
    });
    expect(orders.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(orders.dimensions.amount).toEqual({
      type: 'number', wireType: 'number-or-string', nullable: 'unknown', groupable: true, orderable: true,
    });
    expect(orders.dimensions.paid.wireType).toBe('boolean');
    // Ordered aggregations over strings can't be compared in `having`; the
    // relationship-filtered measure isn't advertised while relationships aren't.
    expect(orders.measures).toEqual({
      revenue: { wireType: 'string', nullable: true, having: true },
      orders: { wireType: 'string', nullable: true, having: true },
      latestStatus: { wireType: 'string', nullable: true, having: false },
      average: { wireType: 'string', nullable: true, having: true },
    });
    if (orders.kind !== 'dataset') throw new Error('expected a dataset endpoint');
    expect([...orders.defaultMeasures].sort()).toEqual(['latestStatus', 'orders', 'revenue']);
  });

  it('never lets a request name the tenant, and narrows operators by type', () => {
    const [orders] = buildClientContract(deployment).contract.endpoints;
    expect(Object.keys(orders.filters).sort()).toEqual(['amount', 'paid', 'status']);
    expect(orders.filters.status.operators).toEqual(['eq', 'in', 'like']);
    expect(orders.filters.paid.operators).toEqual(['eq', 'isNull']);
    expect(orders.filters.amount.operators).toEqual(['gte']);
  });

  it('folds annotation whitespace', () => {
    const [orders] = buildClientContract(deployment).contract.endpoints;
    expect(orders.annotations).toEqual({
      description: 'One row per order.',
      fields: { revenue: { description: 'Gross revenue' }, status: { label: 'Order status' } },
    });
  });

  it('round-trips through the signed contract decoder that generate:client uses', () => {
    const prepared = buildClientContract(deployment);
    expect(decodeProtocolClientContract(prepared.canonical)).toEqual(prepared.contract);
  });

  it('applies host routes, profile and views', () => {
    const build = buildClientContract(deployment);
    const hosted = buildClientContract(deployment, {
      mountPath: '/v1',
      paths: { orders: '/datasets/orders' },
      profile: { maxLimit: 100, defaultLimit: 50, defaultTimezone: 'Europe/London' },
    });
    const [orders] = hosted.contract.endpoints;
    expect(orders.path).toBe('/v1/datasets/orders');
    expect(orders.limits).toMatchObject({ defaultLimit: 50, maxLimit: 100 });
    expect(orders.time?.defaultTimezone).toBe('Europe/London');

    const authorized = buildClientContract(deployment, { view: 'authorized' });
    expect(authorized.contract.view).toBe('authorized');
    // Limits and views don't change an endpoint's schema; the contract hash does.
    expect(authorized.contract.endpoints[0].schemaHash).toBe(build.contract.endpoints[0].schemaHash);
    expect(authorized.contentHash).not.toBe(build.contentHash);
    expect(buildClientContract(deployment, { view: 'authorized', include: () => false }).contract.endpoints).toEqual([]);
  });

  it('refuses an untrusted mount path', () => {
    expect(() => buildClientContract(deployment, { mountPath: 'v1' })).toThrow('mountPath');
    expect(() => buildClientContract(deployment, { mountPath: '/v1/' })).toThrow('mountPath');
    expect(() => buildClientContract(deployment, { paths: { orders: 'datasets/orders' } })).toThrow('absolute endpoint path');
  });
});
