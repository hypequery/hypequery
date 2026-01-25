import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { getSSEConnection } from '@/lib/sse';
import type { QueryHistoryEntry, QueryFilters, QueryEventData } from '@/lib/types';

/**
 * Hook for managing query list state with real-time updates.
 */
export function useQueries(initialFilters: QueryFilters = {}) {
  const [queries, setQueries] = useState<QueryHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<QueryFilters>(initialFilters);

  // Fetch queries from API
  const fetchQueries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getQueries(filters);
      setQueries(result.queries);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch queries'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Initial fetch and refetch on filter change
  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);

  // Subscribe to SSE events for real-time updates
  useEffect(() => {
    const connection = getSSEConnection();
    connection.connect();

    const unsubscribe = connection.onQuery((event) => {
      const data = event.data as QueryEventData;

      setQueries((prev) => {
        const existingIndex = prev.findIndex((q) => q.queryId === data.queryId);

        if (existingIndex >= 0) {
          // Update existing query
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...data,
          };
          return updated;
        } else if (event.type === 'query:start') {
          // Add new query at the beginning
          const newQuery: QueryHistoryEntry = {
            queryId: data.queryId,
            query: data.query ?? '',
            startTime: Date.now(),
            status: data.status,
          };
          return [newQuery, ...prev];
        }

        return prev;
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Clear history
  const clearHistory = useCallback(async () => {
    try {
      await apiClient.clearHistory();
      setQueries([]);
      setTotal(0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to clear history'));
    }
  }, []);

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<QueryFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  return {
    queries,
    total,
    loading,
    error,
    filters,
    refetch: fetchQueries,
    clearHistory,
    updateFilters,
  };
}

/**
 * Hook for getting a single query by ID.
 */
export function useQuery(queryId: string | null) {
  const [query, setQuery] = useState<QueryHistoryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!queryId) {
      setQuery(null);
      return;
    }

    const fetchQuery = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await apiClient.getQuery(queryId);
        setQuery(result);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch query'));
      } finally {
        setLoading(false);
      }
    };

    fetchQuery();
  }, [queryId]);

  // Subscribe to SSE updates for this specific query
  useEffect(() => {
    if (!queryId) return;

    const connection = getSSEConnection();

    const unsubscribe = connection.onQuery((event) => {
      const data = event.data as QueryEventData;
      if (data.queryId === queryId) {
        setQuery((prev) => (prev ? { ...prev, ...data } : null));
      }
    });

    return unsubscribe;
  }, [queryId]);

  return { query, loading, error };
}
