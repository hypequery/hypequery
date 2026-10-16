import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createHypequeryClient } from './client.js';
import { createAnalyticsHooks } from './analyticsHooks.js';
import { HttpError } from './errors.js';

const hash = 'a'.repeat(64);
const metricHash = 'b'.repeat(64);
const manifest = {
  'dataset:orders': { method: 'POST', path: '/api/v1/datasets/orders/query', schemaHash: hash },
  ordersRevenue: { method: 'POST', path: '/api/v1/metrics/revenue', schemaHash: metricHash },
} as const;
function response(body: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe('generated client routes', () => {
  it('preserves per-endpoint POST paths and pins across partial config and cased header overrides', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response({ data: [] }));
    const client = createHypequeryClient({
      baseUrl: 'https://python.example.com/ignored-base-prefix', manifest,
      config: { 'dataset:orders': { method: 'POST' } },
      headers: { 'x-hypequery-client-schema': 'override', 'x-custom': 'kept' }, fetchFn,
    });
    await client.request('dataset:orders', {}, 'GET', { 'X-HYPEQUERY-CLIENT-SCHEMA': 'other' });
    await client.request('ordersRevenue', {});
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://python.example.com/api/v1/datasets/orders/query', expect.objectContaining({
      method: 'POST', body: '{}', headers: { 'x-custom': 'kept', 'content-type': 'application/json', 'X-Hypequery-Client-Schema': hash },
    }));
    expect(fetchFn.mock.calls[1][1].headers['X-Hypequery-Client-Schema']).toBe(metricHash);
  });

  it('preserves generated schema preconditions through api.manifest() and a single auth refresh', async () => {
    let token = 'expired';
    const fetchFn = vi.fn().mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ data: [] }));
    const onUnauthorized = vi.fn(async () => { token = 'fresh'; });
    const client = createHypequeryClient({ baseUrl: '/api', api: { manifest: () => manifest } as never, token: () => token, onUnauthorized, fetchFn });
    await client.request('ordersRevenue', {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(call => call[1].headers.authorization)).toEqual(['Bearer expired', 'Bearer fresh']);
    expect(fetchFn.mock.calls.map(call => call[1].headers['X-Hypequery-Client-Schema'])).toEqual([metricHash, metricHash]);
  });

  it('surfaces schema drift without refreshing auth or substituting a schema', async () => {
    const body = { error: { type: 'VALIDATION_ERROR', details: { code: 'CLIENT_SCHEMA_CHANGED' }, message: 'Client endpoint schema changed.' } };
    const fetchFn = vi.fn().mockResolvedValue(response(body, 409));
    const onUnauthorized = vi.fn();
    const client = createHypequeryClient({ baseUrl: '/api', manifest, fetchFn, onUnauthorized });
    await expect(client.request('ordersRevenue', {})).rejects.toMatchObject({ status: 409, body });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(manifest.ordersRevenue.schemaHash).toBe(metricHash);
  });

  it('keeps legacy routes free of generated precondition headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response({ data: [] }));
    await createHypequeryClient({ baseUrl: '/api', fetchFn }).request('legacy');
    expect(fetchFn.mock.calls[0][1].headers).toEqual({});
  });

  it('supports prototype-like endpoint names as ordinary own entries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response({ data: [] }));
    const client = createHypequeryClient({ baseUrl: '/api', fetchFn, manifest: { ['__proto__']: manifest.ordersRevenue } });
    await client.request('__proto__', {});
    expect(fetchFn.mock.calls[0][0]).toBe('/api/v1/metrics/revenue');
    expect(fetchFn.mock.calls[0][1].headers['X-Hypequery-Client-Schema']).toBe(metricHash);
  });

  it('carries schema and metadata headers across every infinite-query page', async () => {
    const page = (offset: number, hasMore: boolean) => ({ data: [{ country: offset ? null : 'UK', revenue: '12' }], meta: { pagination: { offset, limit: 1, hasMore } } });
    const fetchFn = vi.fn().mockResolvedValueOnce(response(page(0, true))).mockResolvedValueOnce(response(page(1, false)));
    const hooks = createAnalyticsHooks<{ 'dataset:orders': { input: { limit: number }; output: ReturnType<typeof page> } }>({ baseUrl: '/api', manifest, fetchFn });
    const { result } = renderHook(() => hooks.useInfiniteDataset('orders', { limit: 1 }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.map(page => page.data[0].country)).toEqual(['UK', null]);
    for (const call of fetchFn.mock.calls) {
      expect(call[1].headers).toMatchObject({ 'X-Hypequery-Client-Schema': hash, 'x-include-meta': 'true' });
    }
    expect(fetchFn.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([{ limit: 1, offset: 0 }, { limit: 1, offset: 1 }]);
  });

  it('keeps a drift failure available through analytics hooks', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response({}, 409));
    const hooks = createAnalyticsHooks<{ ordersRevenue: { input: {}; output: { data: [] } } }>({ baseUrl: '/api', manifest, fetchFn });
    const { result } = renderHook(() => hooks.useMetric('ordersRevenue', {}), { wrapper });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(HttpError));
    expect(result.current.error?.status).toBe(409);
  });
});
