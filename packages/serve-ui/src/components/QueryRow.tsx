import { Database, Clock, Zap, AlertCircle } from 'lucide-react';
import { cn, formatDuration, formatRelativeTime } from '@/lib/utils';
import { SQLInline } from './SQLViewer';
import { StatusBadge } from './StatusBadge';
import type { QueryHistoryEntry } from '@/lib/types';

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
        {query.cacheHit && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">
            CACHE HIT
          </span>
        )}
        {query.error && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>
    </div>
  );
}

export default QueryRow;
