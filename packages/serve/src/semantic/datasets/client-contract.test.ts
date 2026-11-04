import { describe, expect, it } from 'vitest';
import { buildDatasetClientContract, dataset, dimension, measure } from '@hypequery/datasets';
import { decodeProtocolClientContract } from '@hypequery/protocol';
import { createAPI } from '../../server/create-api.js';
import { semanticFixtureBuilder } from './utils/semantic-fixture-builder.js';
import type { ServeRequest } from '../../types.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: { revenue: measure.sum('amount'), orders: measure.count('country') },
});
const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const rows = [{ country: 'US', revenue: 10, orders: 1, totalRevenue: 10 }];

function api(options: Partial<Parameters<typeof createAPI>[0]> = {}) {
  return createAPI({
    datasets: { orders: Orders },
    metrics: { totalRevenue, monthlyRevenue: totalRevenue.by('month') },
    queryBuilder: semanticFixtureBuilder(rows),
    ...options,
  });
}

function request(path: string, headers: Record<string, string>, body: unknown = {}): ServeRequest {
  return { method: 'POST', path, headers: { 'content-type': 'application/json', ...headers }, query: {}, body };
}

function pinOf(target: ReturnType<typeof api>, id: string): string {
  return target.clientContract().contract.endpoints.find(endpoint => endpoint.id === id)!.schemaHash;
}

describe('api.clientContract()', () => {
  it('exports datasets and metrics at their full paths, as the dataset builder does', () => {
    const target = api({ clientContract: { mountPath: '/edge' } });
    const prepared = target.clientContract();
    expect(prepared.contract.view).toBe('build');
    expect(prepared.contract.endpoints.map(endpoint => [endpoint.id, endpoint.kind, endpoint.path])).toEqual([
      ['orders', 'dataset', '/edge/api/analytics/datasets/orders/query'],
      ['totalRevenue', 'metric', '/edge/api/analytics/metrics/totalRevenue'],
    ]);
    // A metric with a fixed grain always returns a period, which the contract can't say.
    expect(prepared.contract.endpoints.some(endpoint => endpoint.id === 'monthlyRevenue')).toBe(false);
    const expected = buildDatasetClientContract([
      { dataset: Orders, path: '/api/analytics/datasets/orders/query', profile: { maxLimit: 1000, defaultLimit: 1000 } },
      { dataset: Orders, path: '/api/analytics/metrics/totalRevenue', metric: totalRevenue, name: 'totalRevenue', profile: { maxLimit: 1000, defaultLimit: 1000 } },
    ], { mountPath: '/edge' });
    expect(prepared.canonical).toBe(expected.canonical);
    expect(decodeProtocolClientContract(prepared.canonical)).toEqual(prepared.contract);
  });

  it('advertises the endpoint page cap and names the path api.route() serves it at', () => {
    const target = api({ basePath: '', datasets: { orders: { dataset: Orders, maxLimit: 250 } } });
    target.route('/v2/orders', target.queries['dataset:orders']);
    const orders = target.clientContract().contract.endpoints.find(endpoint => endpoint.id === 'orders')!;
    expect(orders.path).toBe('/v2/orders');
    expect(orders.limits).toMatchObject({ maxLimit: 250, defaultLimit: 250 });
  });

  it('keeps the POST route when api.route() serves an endpoint under another method', async () => {
    const target = api();
    target.route('/orders-by-get', target.queries['dataset:orders'], { method: 'GET' });
    const orders = target.clientContract().contract.endpoints.find(endpoint => endpoint.id === 'orders')!;
    expect(orders.path).toBe('/api/analytics/datasets/orders/query');
    const response = await target.handler(request(orders.path, { 'x-hypequery-client-schema': orders.schemaHash }, { dimensions: ['country'] }));
    expect(response.status).toBe(200);
  });

  it('refuses a dataset registered under another name, and a malformed mount path', () => {
    expect(() => api({ datasets: { sales: Orders } }).clientContract()).toThrow(/datasets entry "sales" serves dataset "orders"/);
    expect(() => api({ metrics: { revenue: totalRevenue } }).clientContract()).toThrow(/metrics entry "revenue" serves metric "totalRevenue"/);
    expect(() => api({ clientContract: { mountPath: 'edge/' } })).toThrow(/mountPath/);
  });

  it('builds nothing until it is asked for', () => {
    // A misconfigured entry fails the export, not createAPI or unpinned requests.
    expect(() => api({ datasets: { sales: Orders } })).not.toThrow();
  });
});

describe('X-Hypequery-Client-Schema', () => {
  it('serves a matching pin under the strict client profile', async () => {
    const target = api();
    const response = await target.handler(request('/api/analytics/datasets/orders/query',
      { 'x-hypequery-client-schema': pinOf(target, 'orders') }, { dimensions: ['country'], includeMeta: true }));
    expect(response.status).toBe(200);
    const body = response.body as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data).toEqual([{ country: 'US', revenue: '10', orders: '1' }]);
    expect(Object.keys(body.meta).every(key => ['cache', 'pagination', 'requestId', 'rowCount', 'timingMs'].includes(key))).toBe(true);
    expect(body.meta).toMatchObject({ rowCount: 1, pagination: { limit: 1000, offset: 0, hasMore: false } });
    expect(body.meta.requestId).toBe(response.headers?.['x-request-id']);
  });

  it('refuses a stale pin with 409 before body validation', async () => {
    const target = api();
    const response = await target.handler(request('/api/analytics/datasets/orders/query',
      { 'x-hypequery-client-schema': 'f'.repeat(64) }, { dimensions: ['PRIVATE_COLUMN'] }));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: {
      type: 'VALIDATION_ERROR', message: 'Client endpoint schema changed.', details: { code: 'CLIENT_SCHEMA_CHANGED' },
    } });
    expect(response.headers?.['cache-control']).toBe('no-store');
  });

  it('refuses any pin on an endpoint the contract cannot describe', async () => {
    const grained = api();
    const metric = await grained.handler(request('/api/analytics/metrics/monthlyRevenue',
      { 'x-hypequery-client-schema': pinOf(grained, 'totalRevenue') }));
    expect(metric.status).toBe(409);
    const misnamed = api({ datasets: { sales: Orders } });
    const dataset = await misnamed.handler(request('/api/analytics/datasets/sales/query',
      { 'x-hypequery-client-schema': pinOf(api(), 'orders') }));
    expect(dataset.status).toBe(409);
  });

  it('holds a pinned body to the client profile but leaves unpinned requests as they were', async () => {
    const target = api();
    const path = '/api/analytics/datasets/orders/query';
    // Legacy TypeScript input has no offset ceiling; the client profile does.
    const body = { dimensions: ['country'], offset: 2_000_000 };
    const pinned = await target.handler(request(path, { 'x-hypequery-client-schema': pinOf(target, 'orders') }, body));
    expect(pinned.status).toBe(400);
    expect(pinned.body).toMatchObject({ error: { message: 'Invalid client query.', details: { issues: [{ code: 'HQ_CLIENT_QUERY' }] } } });
    const unpinned = await target.handler(request(path, {}, body));
    expect(unpinned.status).toBe(200);
  });

  it('is allowed by the default CORS preflight', async () => {
    const response = await api({ cors: true }).handler({
      method: 'OPTIONS', path: '/api/analytics/datasets/orders/query', headers: { origin: 'https://app.example.com' }, query: {},
    });
    expect(response.headers?.['access-control-allow-headers']).toContain('X-Hypequery-Client-Schema');
  });
});
