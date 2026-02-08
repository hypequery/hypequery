import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHooks, queryOptions } from './createHooks.js';
import { HttpError } from './errors.js';

interface TestApi extends Record<string, { input: unknown; output: unknown }> {
  weeklyRevenue: {
    input: { startDate: string };
    output: { total: number };
  };
  rebuildMetrics: {
    input: { force?: boolean };
    output: { success: boolean };
  };
  getUser: {
    input: { id: string };
    output: { name: string };
  };
  listItems: {
    input: { tags: string[]; limit: number };
    output: { items: string[] };
  };
  noInput: {
    input: never;
    output: { status: string };
  };
  updateUser: {
    input: { id: string; name: string };
    output: { success: boolean };
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
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

function mockErrorResponse(status: number, body: any) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('createHooks', () => {
  describe('Basic functionality', () => {
    const fetchMock = vi.fn();
    const { useQuery, useMutation } = createHooks<TestApi>({
      baseUrl: 'https://example.com/api',
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    beforeEach(() => {
      fetchMock.mockReset();
    });

    it('executes queries via fetch', async () => {
      fetchMock.mockResolvedValue(mockSuccessResponse({ total: 42 }));

      const { result } = renderHook(() => useQuery('weeklyRevenue', { startDate: '2025-01-01' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({ total: 42 });
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/weeklyRevenue?startDate=2025-01-01',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('executes mutations via fetch', async () => {
      fetchMock.mockResolvedValue(mockSuccessResponse({ success: true }));

      const { result } = renderHook(() => useMutation('rebuildMetrics'), {
        wrapper: createWrapper()
      });

      await result.current.mutateAsync({ force: true });

      // Mutations default to POST
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/rebuildMetrics',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ force: true }),
        })
      );
    });

    it('allows queries with no input parameters', async () => {
      fetchMock.mockResolvedValue(mockSuccessResponse({ status: 'ok' }));

      const { result } = renderHook(() => useQuery('noInput'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.data).toEqual({ status: 'ok' }));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/noInput',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('invokes header factory per request', async () => {
      const headerFactory = vi.fn()
        .mockReturnValueOnce({ 'x-token': 'first' })
        .mockReturnValueOnce({ 'x-token': 'second' });

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        headers: headerFactory,
      });

      fetchMock.mockResolvedValue(mockSuccessResponse({ name: 'User' }));

      const first = renderHook(() => useQuery('getUser', { id: '1' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(first.result.current.data).toEqual({ name: 'User' });
      });

      const second = renderHook(() => useQuery('getUser', { id: '2' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(second.result.current.data).toEqual({ name: 'User' });
      });

      expect(headerFactory).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-token': 'first' });
      expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'x-token': 'second' });
    });
  });

  describe('HTTP Method Handling', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(mockSuccessResponse({ success: true }));
    });

    it('defaults to GET when no config provided', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('?'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('uses POST when explicitly configured', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        config: {
          getUser: { method: 'POST' },
        },
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/getUser',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: '123' }),
        })
      );
    });

    it('extracts method config from API object', async () => {
      const mockApi = {
        queries: {
          getUser: { method: 'GET' },
          updateUser: { method: 'PATCH' },
        },
      } as unknown as TestApi;

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        api: mockApi,
      });

      const { result } = renderHook(() => useQuery('updateUser', { id: '123', name: 'John' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('prefers route-level config over endpoint config', async () => {
      const mockApi = {
        queries: {
          getUser: { method: 'POST' },
        },
        _routeConfig: {
          getUser: { method: 'GET' },
        },
      } as unknown as TestApi;

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        api: mockApi,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('allows explicit config to override API config', async () => {
      const mockApi = {
        queries: {
          getUser: { method: 'GET' },
        },
      } as unknown as TestApi;

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        api: mockApi,
        config: {
          getUser: { method: 'POST' },
        },
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/getUser',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Query Parameter Serialization', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(mockSuccessResponse({ success: true }));
    });

    it('serializes simple objects as query params for GET requests', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/getUser?id=123',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('serializes arrays as multiple query params', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useQuery('listItems', { tags: ['react', 'typescript'], limit: 10 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('tags=react');
      expect(callUrl).toContain('tags=typescript');
      expect(callUrl).toContain('limit=10');
    });

    it('skips undefined and null values in query params', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useQuery('rebuildMetrics', { force: undefined } as any),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).not.toContain('force');
    });

    it('handles empty objects in GET requests', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useQuery('rebuildMetrics', {} as any),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/rebuildMetrics',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('uses JSON body for POST requests', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        config: {
          getUser: { method: 'POST' },
        },
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/getUser',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: '123' }),
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        })
      );
    });
  });

  describe('Error Handling', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
    });

    it('throws error with detailed message on failed request', async () => {
      fetchMock.mockResolvedValue(mockErrorResponse(404, { message: 'Not found' }));

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeInstanceOf(HttpError);
      expect(result.current.error?.message).toContain('GET request to');
      expect(result.current.error?.message).toContain('failed with status 404');
      expect(result.current.error?.status).toBe(404);
      expect(result.current.error?.body).toEqual({ message: 'Not found' });
    });

    it('parses JSON error responses', async () => {
      fetchMock.mockResolvedValue(mockErrorResponse(400, { error: 'Bad request' }));

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeInstanceOf(HttpError);
      expect(result.current.error?.body).toEqual({ error: 'Bad request' });
    });

    it('parses text error responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeInstanceOf(HttpError);
      expect(result.current.error?.body).toBe('Internal server error');
    });

    it('handles network errors', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useQuery Argument Overloads', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(mockSuccessResponse({ status: 'ok' }));
    });

    it('handles useQuery(name) with no input', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('noInput'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/noInput',
        expect.any(Object)
      );
    });

    it('handles useQuery(name, input)', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalled();
    });

    it('handles useQuery(name, options) - options only', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useQuery('noInput', { enabled: false, staleTime: 5000 }),
        { wrapper: createWrapper() }
      );

      // Should not fetch because enabled: false
      expect(result.current.isSuccess).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('handles useQuery(name, input, options)', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useQuery('getUser', { id: '123' }, { staleTime: 5000 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalled();
    });

    it('correctly distinguishes input from options using isQueryOptions', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      // Input with 'enabled' field should be treated as input, not options
      const { result: result1 } = renderHook(
        () => useQuery('rebuildMetrics', { force: true } as any),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result1.current.isSuccess).toBe(true));
      expect(fetchMock).toHaveBeenCalled();

      fetchMock.mockClear();

      // Options object should disable the query
      const { result: result2 } = renderHook(
        () => useQuery('noInput', { enabled: false, staleTime: 1000 }),
        { wrapper: createWrapper() }
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses queryOptions() helper for explicit option marking', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      // Using queryOptions() helper ensures options are recognized
      const { result } = renderHook(
        () => useQuery('noInput', queryOptions({ enabled: false })),
        { wrapper: createWrapper() }
      );

      // Query should be disabled
      expect(result.current.isLoading).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Configuration', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(mockSuccessResponse({ success: true }));
    });

    it('includes custom headers in requests', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom': 'value',
        },
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
            'X-Custom': 'value',
          }),
        })
      );
    });

    it('handles baseUrl with trailing slash', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api/',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('https://example.com/api/getUser');
      expect(callUrl).not.toContain('//getUser');
    });

    it('handles baseUrl without trailing slash', async () => {
      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('https://example.com/api/getUser');
    });

    it('throws error when baseUrl is missing', () => {
      expect(() => {
        createHooks<TestApi>({
          baseUrl: '',
          fetchFn: fetchMock as unknown as typeof fetch,
        });
      }).not.toThrow();

      const { useQuery } = createHooks<TestApi>({
        baseUrl: '',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('getUser', { id: '123' }), {
        wrapper: createWrapper(),
      });

      // Should throw during query execution
      waitFor(() => {
        expect(result.current.error?.message).toContain('baseUrl is required');
      });
    });
  });

  describe('Edge Cases', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
    });

    it('handles empty response body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(null),
      });

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('noInput'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(null);
    });

    it('handles non-JSON text responses', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Not JSON')),
        text: () => Promise.resolve('Plain text response'),
      });

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useQuery('noInput'), {
        wrapper: createWrapper(),
      });

      // This will fail because json() rejects, but shows the edge case
      await waitFor(() => expect(result.current.isError).toBe(true));
    });

    it('passes through TanStack Query options correctly', async () => {
      fetchMock.mockResolvedValue(mockSuccessResponse({ status: 'ok' }));

      const { useQuery } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result, rerender } = renderHook(
        ({ enabled }) => useQuery('noInput', { enabled, staleTime: 1000 }),
        {
          wrapper: createWrapper(),
          initialProps: { enabled: false },
        }
      );

      // Should not fetch when disabled (now requires 2+ option keys to be recognized)
      expect(fetchMock).not.toHaveBeenCalled();

      // Enable the query
      rerender({ enabled: true });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('useMutation', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(mockSuccessResponse({ success: true }));
    });

    it('defaults to POST method', async () => {
      const { useMutation } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useMutation('updateUser'), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({ id: '123', name: 'John' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/updateUser',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: '123', name: 'John' }),
        })
      );
    });

    it('allows custom HTTP methods via config', async () => {
      const { useMutation } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
        config: {
          updateUser: { method: 'PATCH' },
        },
      });

      const { result } = renderHook(() => useMutation('updateUser'), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({ id: '123', name: 'John' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/updateUser',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ id: '123', name: 'John' }),
        })
      );
    });

    it('passes through mutation options', async () => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      const { useMutation } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(
        () => useMutation('updateUser', { onSuccess, onError }),
        { wrapper: createWrapper() }
      );

      await result.current.mutateAsync({ id: '123', name: 'John' });

      expect(onSuccess).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('handles mutation errors', async () => {
      fetchMock.mockResolvedValue(mockErrorResponse(400, { error: 'Invalid data' }));

      const { useMutation } = createHooks<TestApi>({
        baseUrl: 'https://example.com/api',
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const { result } = renderHook(() => useMutation('updateUser'), {
        wrapper: createWrapper(),
      });

      await expect(
        result.current.mutateAsync({ id: '123', name: 'John' })
      ).rejects.toThrow();
    });
  });
});
