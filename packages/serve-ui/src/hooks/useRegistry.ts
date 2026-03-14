import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { RegistryEntry } from '@/lib/types';

/**
 * Hook for fetching the endpoint registry.
 */
export function useRegistry() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getRegistry();
      setEntries(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch registry'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  return {
    entries,
    loading,
    error,
    refetch: fetchRegistry,
  };
}
