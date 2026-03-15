import { useState, useMemo } from 'react';
import { Search, Filter, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueries } from '@/hooks/useQueries';
import { useFilters } from '@/hooks/useFilters';
import { QueryRow } from './QueryRow';
import { QueryDetail } from './QueryDetail';
import { EmptyState, FilteredEmptyState } from './EmptyState';
import { QueryListSkeleton } from './Skeleton';
import type { QueryFilters } from '@/lib/types';

interface QueryHistoryProps {
  className?: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'error', label: 'Error' },
] as const;

const CACHE_OPTIONS = [
  { value: '', label: 'All cache' },
  { value: 'true', label: 'Cache hits' },
  { value: 'false', label: 'Cache misses' },
] as const;

/**
 * Query history list with filtering and search.
 */
export function QueryHistory({ className }: QueryHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { filters: filterState, setSearch, setStatus, setCache, togglePanel, reset, hasActiveFilters } = useFilters();

  // Build API filters from filter state
  const apiFilters: QueryFilters = useMemo(() => {
    const f: QueryFilters = { limit: 100 };
    if (filterState.search) f.search = filterState.search;
    if (filterState.status) f.status = filterState.status as QueryFilters['status'];
    if (filterState.cache) f.cacheHit = filterState.cache === 'true';
    return f;
  }, [filterState.search, filterState.status, filterState.cache]);

  const { queries, total, loading, error, refetch, clearHistory } = useQueries(apiFilters);

  // Get selected query
  const selectedQuery = queries.find((q) => q.queryId === selectedId);

  if (error) {
    return (
      <div className={cn('p-4 text-center text-destructive', className)}>
        <p>Failed to load queries: {error.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-sm underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* Query list */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        {/* Toolbar */}
        <div className="flex-shrink-0 p-4 border-b border-border">
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search queries..."
              value={filterState.search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Filter toggle and actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={togglePanel}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                filterState.showPanel
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              )}
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-primary-foreground" />}
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', filterState.showPanel && 'rotate-180')}
              />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => refetch()}
                disabled={loading}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
              <button
                onClick={() => {
                  if (confirm('Clear all query history?')) {
                    clearHistory();
                    setSelectedId(null);
                  }
                }}
                className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-muted transition-colors"
                title="Clear history"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Filter options */}
          {filterState.showPanel && (
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                value={filterState.status}
                onChange={(e) => setStatus(e.target.value)}
                className="px-3 py-1.5 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={filterState.cache}
                onChange={(e) => setCache(e.target.value)}
                className="px-3 py-1.5 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CACHE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button
                  onClick={reset}
                  className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Query count */}
        <div className="flex-shrink-0 px-4 py-2 text-xs text-muted-foreground border-b border-border">
          {loading ? 'Loading...' : `${total} ${total === 1 ? 'query' : 'queries'}`}
        </div>

        {/* Query list */}
        <div className="flex-1 overflow-auto">
          {loading && queries.length === 0 ? (
            <QueryListSkeleton count={8} />
          ) : queries.length === 0 ? (
            hasActiveFilters ? (
              <FilteredEmptyState onClear={reset} />
            ) : (
              <EmptyState type="no-history" />
            )
          ) : (
            queries.map((query) => (
              <QueryRow
                key={query.queryId}
                query={query}
                isSelected={query.queryId === selectedId}
                onClick={() => setSelectedId(query.queryId)}
              />
            ))
          )}
        </div>
      </div>

      {/* Query detail panel - responsive */}
      <div className="hidden md:block w-[450px] flex-shrink-0 overflow-auto bg-card">
        {selectedQuery ? (
          <QueryDetail query={selectedQuery} onClose={() => setSelectedId(null)} />
        ) : (
          <EmptyState
            type="no-results"
            title="Select a query"
            description="Click on a query in the list to view its details, SQL, and performance metrics."
            className="h-full"
          />
        )}
      </div>

      {/* Mobile detail modal */}
      {selectedQuery && (
        <div className="md:hidden fixed inset-0 z-50 bg-background">
          <QueryDetail query={selectedQuery} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}

export default QueryHistory;
