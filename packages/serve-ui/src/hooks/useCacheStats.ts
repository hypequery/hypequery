import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { CacheStats } from '@/lib/types';

/**
 * Hook for managing cache statistics.
 */
export function useCacheStats() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getCacheStats();
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch cache stats'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchStats, 5000);

    return () => clearInterval(interval);
  }, [fetchStats]);

  const invalidateKeys = useCallback(async (keys: string[]) => {
    try {
      await apiClient.invalidateCache(keys);
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to invalidate cache'));
    }
  }, [fetchStats]);

  const clearCache = useCallback(async () => {
    try {
      await apiClient.clearCache();
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to clear cache'));
    }
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
    invalidateKeys,
    clearCache,
  };
}
