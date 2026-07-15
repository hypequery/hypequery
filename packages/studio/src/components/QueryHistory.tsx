import { useState, useMemo } from 'react';
import { Search, Trash2, RefreshCw } from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useQueries } from '@/hooks/useQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { queryColumns, QUERY_GRID_COLS } from './query-columns';
import { EmptyState } from './EmptyState';
import { QueryListSkeleton } from './Skeleton';
import type { QueryFilters } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tooltip } from './ui/tooltip';

interface QueryHistoryProps {
  className?: string;
}

/**
 * Query history table with filtering and search.
 *
 * Read-only for this release: rows are not clickable and there is no detail
 * drilldown — the per-query detail panel (QueryDetail) returns in a later
 * release once its interaction model is settled.
 */
export function QueryHistory({ className }: QueryHistoryProps) {
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
    <div className={cn('flex h-full flex-col min-w-0', className)}>
      {/* Toolbar: search + actions on one row */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/45 px-4 py-3 md:px-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search runs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tooltip content="Refresh">
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh"
            onClick={() => refetch()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </Tooltip>
        <Tooltip content="Clear history">
          <Button
            variant="outline"
            size="sm"
            aria-label="Clear history"
            onClick={() => {
              if (confirm('Clear all query history?')) {
                clearHistory();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      {/* Query count */}
      <div className="flex-shrink-0 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        {loading ? 'Loading...' : `${total} ${total === 1 ? 'query' : 'queries'}`}
      </div>

      {/* Header lives inside the scroll container so it shares the rows'
          scrollbar gutter — outside it, header and cells disagree by the
          scrollbar width. Sticky keeps it visible; the solid background
          layer stops rows showing through as they scroll under. */}
      <div className="flex-1 overflow-auto">
        {table.getHeaderGroups().map((headerGroup) => (
          <div key={headerGroup.id} className="sticky top-0 z-10 bg-background">
            <div
              className={cn(
                'grid gap-3 border-b border-border bg-muted/45 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:px-6',
                QUERY_GRID_COLS
              )}
            >
              {headerGroup.headers.map((header) => (
                <div key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              ))}
            </div>
          </div>
        ))}
        {loading && queries.length === 0 ? (
          <QueryListSkeleton count={8} />
        ) : queries.length === 0 ? (
            <EmptyState type="no-history" />
        ) : (
          table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                'grid w-full items-center gap-3 border-b border-border bg-card/35 px-4 py-3 transition-colors hover:bg-card md:px-6',
                QUERY_GRID_COLS
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id} className="min-w-0">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default QueryHistory;
