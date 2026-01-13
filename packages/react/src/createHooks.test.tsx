import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHooks } from './createHooks.js';

interface TestApi {
  weeklyRevenue: {
    input: { startDate: string };
    output: { total: number };
  };
  rebuildMetrics: {
    input: { force?: boolean };
    output: { success: boolean };
  };
}

describe('createHooks', () => {
  const fetchMock = vi.fn();
  const { useQuery, useMutation, HypequeryProvider } = createHooks<TestApi>({
    baseUrl: 'https://example.com/api',
    fetchFn: fetchMock as unknown as typeof fetch,
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('throws if provider is missing', () => {
    const { result } = renderHook(() => useQuery('weeklyRevenue', { startDate: '2025-01-01' }), {
      wrapper: ({ children }) => children,
    });
    expect(result.error?.message).toContain('HypequeryProvider is missing');
  });

  it('executes queries via fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total: 42 }),
    });

    const queryClient = new QueryClient();

    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <HypequeryProvider>{children}</HypequeryProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useQuery('weeklyRevenue', { startDate: '2025-01-01' }), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ total: 42 });
    });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/weeklyRevenue', expect.any(Object));
  });

  it('executes mutations via fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const queryClient = new QueryClient();

    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <HypequeryProvider>{children}</HypequeryProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useMutation('rebuildMetrics'), { wrapper });

    await result.current.mutateAsync({ force: true });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/rebuildMetrics', expect.any(Object));
  });
});
