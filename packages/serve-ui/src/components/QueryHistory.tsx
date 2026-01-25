import { useState, useMemo } from 'react';
import { Search, Filter, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueries } from '@/hooks/useQueries';
import { QueryRow } from './QueryRow';
import { QueryDetail } from './QueryDetail';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cacheFilter, setCacheFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Build filters
  const filters: QueryFilters = useMemo(() => {
    const f: QueryFilters = { limit: 100 };
    if (searchQuery) f.search = searchQuery;
    if (statusFilter) f.status = statusFilter as QueryFilters['status'];
    if (cacheFilter) f.cacheHit = cacheFilter === 'true';
    return f;
  }, [searchQuery, statusFilter, cacheFilter]);

  const { queries, total, loading, error, refetch, clearHistory } = useQueries(filters);

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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Filter toggle and actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                showFilters
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              )}
            >
              <Filter className="h-4 w-4" />
              Filters
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', showFilters && 'rotate-180')}
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
          {showFilters && (
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={cacheFilter}
                onChange={(e) => setCacheFilter(e.target.value)}
                className="px-3 py-1.5 text-sm bg-muted border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CACHE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Query count */}
        <div className="flex-shrink-0 px-4 py-2 text-xs text-muted-foreground border-b border-border">
          {loading ? 'Loading...' : `${total} ${total === 1 ? 'query' : 'queries'}`}
        </div>

        {/* Query list */}
        <div className="flex-1 overflow-auto">
          {queries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No queries found</p>
              {(searchQuery || statusFilter || cacheFilter) && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('');
                    setCacheFilter('');
                  }}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
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

      {/* Query detail panel */}
      <div className="w-[450px] flex-shrink-0 overflow-auto bg-card">
        {selectedQuery ? (
          <QueryDetail query={selectedQuery} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p>Select a query to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default QueryHistory;
