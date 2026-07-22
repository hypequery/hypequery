import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Endpoint registry from GET /registry. The registry only changes when the
 * dev server restarts (endpoints are registered at build time), so a long
 * stale time is safe; Refresh-by-reload covers the restart case.
 */
export function useRegistry() {
  const registryQuery = useQuery({
    queryKey: ['registry'],
    queryFn: () => apiClient.getRegistry(),
    staleTime: 5 * 60 * 1000,
  });

  return {
    endpoints: registryQuery.data?.endpoints ?? [],
    loading: registryQuery.isPending,
    error: registryQuery.error as Error | null,
  };
}
