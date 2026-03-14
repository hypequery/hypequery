import { Database, Clock, Zap, AlertCircle } from 'lucide-react';
import { cn, formatDuration, formatRelativeTime } from '@/lib/utils';
import { SQLInline } from './SQLViewer';
import { StatusBadge } from './StatusBadge';
import type { QueryHistoryEntry, CacheStatus } from '@/lib/types';

/**
 * Get the display config for a cache status.
 */
function getCacheStatusDisplay(status: CacheStatus | undefined, cacheHit?: boolean): {
  label: string;
  className: string;
} | null {
  // Handle new cacheStatus field
  if (status) {
    switch (status) {
      case 'hit':
        return {
          label: 'CACHE HIT',
          className: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
        };
      case 'stale':
        return {
          label: 'STALE',
          className: 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
        };
      case 'miss':
        return {
          label: 'MISS',
          className: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50',
        };
      case 'bypass':
        return {
          label: 'BYPASS',
          className: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30',
        };
    }
  }
  // Fallback for legacy cacheHit boolean
  if (cacheHit) {
    return {
      label: 'CACHE HIT',
      className: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    };
  }
  return null;
}

interface QueryRowProps {
  query: QueryHistoryEntry;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * Single query row in the history list.
 */
export function QueryRow({ query, isSelected, onClick }: QueryRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 border-b border-border cursor-pointer transition-colors',
        'hover:bg-muted/50',
        isSelected && 'bg-muted'
      )}
      onClick={onClick}
    >
      {/* Status indicator */}
      <div className="flex-shrink-0">
        <StatusBadge status={query.status} />
      </div>

      {/* Query preview */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 mb-1">
          {query.endpointKey && (
            <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
              {query.endpointKey}
            </span>
          )}
          <SQLInline sql={query.query} maxLength={80} className="text-foreground/80" />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(query.startTime)}
          </span>
          {query.duration !== undefined && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {formatDuration(query.duration)}
            </span>
          )}
          {query.rowCount !== undefined && (
            <span className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              {query.rowCount.toLocaleString()} rows
            </span>
          )}
        </div>
      </div>

      {/* Cache indicator */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {(() => {
          const cacheDisplay = getCacheStatusDisplay(query.cacheStatus, query.cacheHit);
          return cacheDisplay ? (
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded', cacheDisplay.className)}>
              {cacheDisplay.label}
            </span>
          ) : null;
        })()}
        {query.error && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>
    </div>
  );
}

export default QueryRow;
