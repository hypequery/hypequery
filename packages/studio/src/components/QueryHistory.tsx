import { useState, useMemo } from 'react';
import { Search, Trash2, RefreshCw } from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useQueries } from '@/hooks/useQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { queryColumns, QUERY_GRID_COLS } from './query-columns';
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
  // Debounce so typing does not fire a fetch per keystroke; the input itself
  // stays bound to `search` for immediate feedback.
  const debouncedSearch = useDebouncedValue(search, 300);

  // Build API filters from filter state
  const apiFilters: QueryFilters = useMemo(() => {
    const f: QueryFilters = { limit: 100 };
    if (debouncedSearch) f.search = debouncedSearch;
    return f;
  }, [debouncedSearch]);

  const { queries, total, loading, error, refetch, clearHistory } = useQueries(apiFilters);

  const table = useReactTable({
    data: queries,
    columns: queryColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.queryId,
  });

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

        {table.getHeaderGroups().map((headerGroup) => (
          <div
            key={headerGroup.id}
            className={cn(
              'grid gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
              QUERY_GRID_COLS
            )}
          >
            {headerGroup.headers.map((header) => (
              <div key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}

        {/* Query list */}
        <div className="flex-1 overflow-auto">
          {loading && queries.length === 0 ? (
            <QueryListSkeleton count={8} />
          ) : queries.length === 0 ? (
              <EmptyState type="no-history" />
          ) : (
            table.getRowModel().rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={cn(
                  'grid w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                  'border-b border-border hover:bg-muted/40',
                  QUERY_GRID_COLS,
                  row.id === selectedId && 'bg-muted'
                )}
                onClick={() => setSelectedId(row.id)}
              >
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} className="min-w-0">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </button>
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
