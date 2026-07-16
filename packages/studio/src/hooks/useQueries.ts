import { useEffect } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getSSEConnection } from '@/lib/sse';
import type { QueryFilters, QueryHistoryEntry } from '@/lib/types';

/** Query-key factory for gateway history data. */
export const historyKeys = {
  all: ['history'] as const,
  list: (filters: QueryFilters) => ['history', 'list', filters] as const,
  detail: (queryId: string) => ['history', 'detail', queryId] as const,
};

/**
 * Query history list backed by TanStack Query. Live updates come from the
 * gateway's SSE stream: each query lifecycle event invalidates the history
 * cache, and React Query coalesces concurrent invalidations into one refetch.
 */
export function useQueries(filters: QueryFilters = {}) {
  const queryClient = useQueryClient();

  const historyQuery = useQuery({
    queryKey: historyKeys.list(filters),
    queryFn: () => apiClient.getQueries(filters),
    // Keep the previous page on filter/search changes so the list doesn't
    // flash empty while the new result loads.
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const connection = getSSEConnection();
    connection.connect();
    return connection.onQuery(() => {
      void queryClient.invalidateQueries({ queryKey: historyKeys.all });
    });
  }, [queryClient]);

  const clearMutation = useMutation({
    mutationFn: () => apiClient.clearHistory(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: historyKeys.all }),
  });

  return {
    queries: historyQuery.data?.queries ?? [],
    total: historyQuery.data?.total ?? 0,
    loading: historyQuery.isPending,
    error: (historyQuery.error ?? clearMutation.error) as Error | null,
    refetch: historyQuery.refetch,
    clearHistory: clearMutation.mutate,
  };
}

/**
 * Single history entry, kept live by the same SSE-driven invalidation.
 */
export function useQueryDetail(queryId: string | null) {
  const detailQuery = useQuery({
    queryKey: historyKeys.detail(queryId ?? ''),
    queryFn: () => apiClient.getQuery(queryId as string),
    enabled: queryId != null,
  });

  return {
    query: (detailQuery.data ?? null) as QueryHistoryEntry | null,
    loading: detailQuery.isPending && queryId != null,
    error: detailQuery.error as Error | null,
  };
}
