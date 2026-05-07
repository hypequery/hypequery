import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createSemanticHooks } from './semanticHooks.js';

type SemanticApi = {
  totalRevenue: {
    input: { dimensions?: string[] };
    output: { data: Array<{ totalRevenue: number }> };
  };
  monthlyRevenue: {
    input: { dimensions?: string[]; by?: 'month' };
    output: { data: Array<{ period: string; monthlyRevenue: number }> };
  };
  'dataset:orders': {
    input: { dimensions?: string[]; measures?: string[]; filters?: Array<{ field: string; operator: string; value: unknown }> };
    output: { data: Array<{ country: string; revenue: number }> };
  };
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

function mockSuccessResponse<T>(data: T) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response;
}

describe('createSemanticHooks', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('queries metrics through useMetric with metric names only', async () => {
    fetchMock.mockResolvedValue(mockSuccessResponse({ data: [{ totalRevenue: 42 }] }));

    const { useMetric } = createSemanticHooks<SemanticApi>({
      baseUrl: '/api/analytics',
      fetchFn: fetchMock as unknown as typeof fetch,
      metrics: ['totalRevenue', 'monthlyRevenue'],
      config: {
        totalRevenue: { method: 'POST', path: '/api/analytics/metrics/totalRevenue' },
      },
    });

    const { result } = renderHook(
      () => useMetric('totalRevenue', { dimensions: ['country'] }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ data: [{ totalRevenue: 42 }] });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analytics/metrics/totalRevenue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dimensions: ['country'] }),
      }),
    );
  });

  it('queries datasets through useDataset without exposing dataset: keys', async () => {
    fetchMock.mockResolvedValue(mockSuccessResponse({ data: [{ country: 'US', revenue: 120 }] }));

    const { useDataset } = createSemanticHooks<SemanticApi>({
      baseUrl: '/api/analytics',
      fetchFn: fetchMock as unknown as typeof fetch,
      metrics: [] as const,
      config: {
        'dataset:orders': { method: 'POST', path: '/api/analytics/datasets/orders/query' },
      },
    });

    const { result } = renderHook(
      () => useDataset('orders', { dimensions: ['country'], measures: ['revenue'] }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ data: [{ country: 'US', revenue: 120 }] });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analytics/datasets/orders/query',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dimensions: ['country'], measures: ['revenue'] }),
      }),
    );
  });

  it('supports metric names from the declared semantic metric list', async () => {
    fetchMock.mockResolvedValue(mockSuccessResponse({ data: [{ period: '2025-01-01', monthlyRevenue: 90 }] }));

    const { useMetric } = createSemanticHooks<SemanticApi>({
      baseUrl: '/api/analytics',
      fetchFn: fetchMock as unknown as typeof fetch,
      metrics: ['totalRevenue', 'monthlyRevenue'],
      config: {
        monthlyRevenue: { method: 'POST', path: '/api/analytics/metrics/monthlyRevenue' },
      },
    });

    const { result } = renderHook(
      () => useMetric('monthlyRevenue', { by: 'month' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ data: [{ period: '2025-01-01', monthlyRevenue: 90 }] });
    });
  });

  it('resolves semantic config paths against an absolute baseUrl host', async () => {
    fetchMock.mockResolvedValue(mockSuccessResponse({ data: [{ totalRevenue: 42 }] }));

    const { useMetric } = createSemanticHooks<SemanticApi>({
      baseUrl: 'https://api.example.com/hypequery',
      fetchFn: fetchMock as unknown as typeof fetch,
      metrics: ['totalRevenue', 'monthlyRevenue'],
      config: {
        totalRevenue: { method: 'POST', path: '/api/analytics/metrics/totalRevenue' },
      },
    });

    const { result } = renderHook(
      () => useMetric('totalRevenue', { dimensions: ['country'] }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ data: [{ totalRevenue: 42 }] });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/analytics/metrics/totalRevenue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dimensions: ['country'] }),
      }),
    );
  });
});
