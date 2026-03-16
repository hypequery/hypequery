import { Database, Clock, Zap, AlertCircle } from 'lucide-react';
import { cn, formatDuration, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ICON_SIZES } from '@/lib/colors';
import { SQLInline } from './SQLViewer';
import { StatusBadge } from './StatusBadge';
import { TenantBadge } from './TenantBadge';
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
    <button
      type="button"
      className={cn(
        'grid w-full grid-cols-[140px_minmax(0,1.25fr)_minmax(0,0.95fr)_120px_110px_110px_auto] items-center gap-3 px-4 py-3 text-left transition-colors',
        'border-b border-border hover:bg-muted/40',
        isSelected && 'bg-muted'
      )}
      onClick={onClick}
    >
      <div className="min-w-0">
        <StatusBadge status={query.status} />
      </div>
      <div className="min-w-0">
        <div className="mb-1 truncate text-sm font-medium">
          {query.endpointKey ?? 'Ad hoc query'}
        </div>
        {query.endpointDescription && (
          <p className="mb-1 truncate text-xs text-muted-foreground">
            {query.endpointDescription}
          </p>
        )}
        <SQLInline sql={query.query} maxLength={110} className="text-foreground/70" />
      </div>
      <div className="min-w-0">
        <code className="block truncate text-xs text-muted-foreground">
          {formatInputPreview(query.input)}
        </code>
      </div>
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className={ICON_SIZES.xs} />
          {formatRelativeTime(query.startTime)}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className={ICON_SIZES.xs} />
          {formatDuration(query.duration)}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Database className={ICON_SIZES.xs} />
          {query.rowCount != null ? `${formatNumber(query.rowCount)} rows` : '-'}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {query.tenantId && <TenantBadge tenantId={query.tenantId} />}
        {query.error && (
          <AlertCircle className={cn(ICON_SIZES.md, 'text-destructive')} />
        )}
      </div>
    </button>
  );
}

function formatInputPreview(input: unknown): string {
  if (input == null) return '-';
  try {
    const serialized = JSON.stringify(input);
    return serialized.length > 90 ? `${serialized.slice(0, 87)}...` : serialized;
  } catch {
    return String(input);
  }
}

export default QueryRow;
