import { decodeProtocolClientContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, divide, eq, measure, nullIfZero } from '../index.js';
import { buildDatasetClientContract } from './build-from-datasets.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), country: dimension.string() },
});
const Orders = dataset('orders', {
  source: 'orders',
  description: 'One row per order.',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  timeGrains: ['month', 'day'],
  dimensions: {
    tenant: dimension.string({ column: 'tenant_id' }),
    status: dimension.string({ label: '  Order   status ' }),
    paid: dimension.boolean(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at', groupable: false }),
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
    trailingRevenue: measure.trailing('revenue', { amount: 7, unit: 'day' }),
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
const revenueMetric = Orders.metric('totalRevenue', { measure: 'revenue', label: 'Total revenue' });

describe('buildDatasetClientContract', () => {
  it('advertises a dataset endpoint with typed fields, its route and hashes', () => {
    const { contract } = buildDatasetClientContract([{ dataset: Orders, path: '/datasets/orders/query' }], { mountPath: '/api' });
    expect(contract).toMatchObject({ kind: 'hypequery-client-contract', version: 1, view: 'build' });
    const [orders] = contract.endpoints;
    expect(orders).toMatchObject({
      id: 'orders',
      kind: 'dataset',
      dataset: 'orders',
      path: '/api/datasets/orders/query',
      metadata: true,
      time: { grains: ['day', 'month'], defaultTimezone: 'UTC', timezone: true },
      limits: { defaultLimit: 500, maxLimit: 500, maxMeasures: 10, maxDimensions: 100, maxOffset: 1_000_000 },
    });
    expect(orders.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(orders.dimensions.amount).toEqual({ type: 'number', wireType: 'number-or-string', nullable: 'unknown', groupable: true, orderable: true });
    expect(orders.dimensions.createdAt).toMatchObject({ groupable: false, orderable: false });
  });

  it('leaves out relationship-crossing, window and tenant fields', () => {
    const [orders] = buildDatasetClientContract([{ dataset: Orders, path: '/orders' }]).contract.endpoints;
    expect(Object.keys(orders.measures).sort()).toEqual(['average', 'latestStatus', 'orders', 'revenue']);
    expect(orders.measures.latestStatus).toEqual({ wireType: 'string', nullable: true, having: false });
    expect(orders.measures.average.having).toBe(true);
    expect(orders.kind === 'dataset' && orders.defaultMeasures).toEqual(['revenue', 'orders', 'latestStatus']);
    // Booleans keep equality, membership and null checks; numbers drop `like`; the tenant is never a request filter.
    expect(orders.filters).toEqual({
      status: { type: 'string', operators: ['eq', 'in', 'like'] },
      paid: { type: 'boolean', operators: ['eq', 'isNull'] },
      amount: { type: 'number', operators: ['gte'] },
    });
  });

  it('describes a metric by its export ID, with its value under the metric name', () => {
    const [metric] = buildDatasetClientContract([
      { dataset: Orders, path: '/metrics/revenue', metric: revenueMetric, name: 'revenue' },
    ]).contract.endpoints;
    expect(metric).toMatchObject({ id: 'revenue', kind: 'metric', dataset: 'orders' });
    expect(metric.measures).toEqual({ totalRevenue: { wireType: 'string', nullable: true, having: false } });
    expect('defaultMeasures' in metric).toBe(false);
    expect(metric.annotations?.fields?.totalRevenue).toEqual({ label: 'Total revenue', description: 'Gross revenue' });
  });

  it('advertises a formula that uses another formula more than once', () => {
    const Shared = dataset('shared', {
      source: 'shared',
      dimensions: { amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        orders: measure.count('amount'),
        average: measure.derived({
          uses: { revenue: 'revenue', orders: 'orders' },
          formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
        }),
        averageRatio: measure.derived({
          uses: { left: 'average', right: 'average' },
          formula: ({ left, right }) => divide(left, nullIfZero(right)),
        }),
      },
    });
    const [shared] = buildDatasetClientContract([{ dataset: Shared, path: '/shared' }]).contract.endpoints;
    expect(Object.keys(shared.measures).sort()).toEqual(['average', 'averageRatio', 'orders', 'revenue']);
  });

  it('folds annotation whitespace and keeps annotations out of the schema hash', () => {
    const [orders] = buildDatasetClientContract([{ dataset: Orders, path: '/orders' }]).contract.endpoints;
    expect(orders.annotations).toEqual({
      description: 'One row per order.',
      fields: { status: { label: 'Order status' }, revenue: { description: 'Gross revenue' } },
    });
    const plain = dataset('orders', { ...Orders, description: undefined, dimensions: Orders.dimensions, measures: Orders.measures });
    const [bare] = buildDatasetClientContract([{ dataset: plain, path: '/orders' }]).contract.endpoints;
    expect(bare.schemaHash).toBe(orders.schemaHash);
  });

  it('narrows the host profile and produces a contract generate:client decodes', () => {
    const prepared = buildDatasetClientContract([
      { dataset: Orders, path: '/orders', profile: { maxLimit: 100, defaultLimit: 25, defaultTimezone: 'Europe/Paris' } },
    ]);
    const [orders] = prepared.contract.endpoints;
    expect(orders.limits).toMatchObject({ maxLimit: 100, defaultLimit: 25 });
    expect(orders.time?.defaultTimezone).toBe('Europe/Paris');
    expect(decodeProtocolClientContract(prepared.canonical)).toEqual(prepared.contract);
  });

  it('refuses unsafe mounts, relative paths and a metric named like its dataset', () => {
    expect(() => buildDatasetClientContract([], { mountPath: '/api/' })).toThrow(/mountPath/);
    expect(() => buildDatasetClientContract([{ dataset: Orders, path: 'orders' }])).toThrow(/absolute path/);
    expect(() => buildDatasetClientContract([{ dataset: Orders, path: '/m', metric: revenueMetric, name: 'orders' }]))
      .toThrow(/export ID other than/);
  });
});
