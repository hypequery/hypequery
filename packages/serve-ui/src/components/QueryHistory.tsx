import { useState, useMemo } from 'react';
import { Search, Trash2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueries } from '@/hooks/useQueries';
import { QueryRow } from './QueryRow';
import { QueryDetail } from './QueryDetail';
import { EmptyState } from './EmptyState';
import { QueryListSkeleton } from './Skeleton';
import type { QueryFilters } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface QueryHistoryProps {
  className?: string;
}

/**
 * Query history list with filtering and search.
 */
export function QueryHistory({ className }: QueryHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Build API filters from filter state
  const apiFilters: QueryFilters = useMemo(() => {
    const f: QueryFilters = { limit: 100 };
    if (search) f.search = search;
    return f;
  }, [search]);

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
            <Input
              type="text"
              placeholder="Search runs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
                onClick={() => {
                  if (confirm('Clear all query history?')) {
                    clearHistory();
                    setSelectedId(null);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Clear
            </Button>
          </div>
        </div>

        {/* Query count */}
        <div className="flex-shrink-0 px-4 py-2 text-xs text-muted-foreground border-b border-border">
          {loading ? 'Loading...' : `${total} ${total === 1 ? 'query' : 'queries'}`}
        </div>

        <div className="grid grid-cols-[140px_minmax(0,1.25fr)_minmax(0,0.95fr)_120px_110px_110px_auto] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <div>Status</div>
          <div>Query</div>
          <div>Inputs</div>
          <div>Started</div>
          <div>Duration</div>
          <div>Rows</div>
          <div className="text-right">Meta</div>
        </div>

        {/* Query list */}
        <div className="flex-1 overflow-auto">
          {loading && queries.length === 0 ? (
            <QueryListSkeleton count={8} />
          ) : queries.length === 0 ? (
              <EmptyState type="no-history" />
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
