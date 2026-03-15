import { useState, useCallback, useMemo } from 'react';

export interface FilterState {
  search: string;
  status: string;
  cache: string;
  showPanel: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  cache: '',
  showPanel: false,
};

/**
 * Hook for managing filter state in a consolidated way.
 * Replaces multiple useState calls with a single state object.
 */
export function useFilters(initial: Partial<FilterState> = {}) {
  const [filters, setFilters] = useState<FilterState>({
    ...DEFAULT_FILTERS,
    ...initial,
  });

  const setSearch = useCallback((search: string) => {
    setFilters(f => ({ ...f, search }));
  }, []);

  const setStatus = useCallback((status: string) => {
    setFilters(f => ({ ...f, status }));
  }, []);

  const setCache = useCallback((cache: string) => {
    setFilters(f => ({ ...f, cache }));
  }, []);

  const togglePanel = useCallback(() => {
    setFilters(f => ({ ...f, showPanel: !f.showPanel }));
  }, []);

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters = useMemo(() => {
    return filters.search !== '' || filters.status !== '' || filters.cache !== '';
  }, [filters.search, filters.status, filters.cache]);

  return {
    filters,
    setSearch,
    setStatus,
    setCache,
    togglePanel,
    reset,
    hasActiveFilters,
  };
}
