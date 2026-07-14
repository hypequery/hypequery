import { createColumnHelper } from '@tanstack/react-table';
import { Database, Clock, Zap, AlertCircle } from 'lucide-react';
import { cn, formatDuration, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ICON_SIZES } from '@/lib/colors';
import { SQLInline } from './SQLViewer';
import { StatusBadge } from './StatusBadge';
import { TenantBadge } from './TenantBadge';
import type { QueryHistoryEntry } from '@/lib/types';

/** Shared grid template so the header and rows always align. */
export const QUERY_GRID_COLS =
  'grid-cols-[140px_minmax(0,1.25fr)_minmax(0,0.95fr)_120px_110px_110px_auto]';

function formatInputPreview(input: unknown): string {
  if (input == null) return '-';
  try {
    const serialized = JSON.stringify(input);
    return serialized.length > 90 ? `${serialized.slice(0, 87)}...` : serialized;
  } catch {
    return String(input);
  }
}

const columnHelper = createColumnHelper<QueryHistoryEntry>();

export const queryColumns = [
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => (
      <div className="min-w-0">
        <StatusBadge status={info.getValue()} />
      </div>
    ),
  }),
  columnHelper.display({
    id: 'query',
    header: 'Query',
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="mb-1 truncate text-sm font-medium">
          {row.original.endpointKey ?? 'Ad hoc query'}
        </div>
        {row.original.endpointDescription && (
          <p className="mb-1 truncate text-xs text-muted-foreground">
            {row.original.endpointDescription}
          </p>
        )}
        <SQLInline sql={row.original.query} maxLength={110} className="text-foreground/70" />
      </div>
    ),
  }),
  columnHelper.accessor('input', {
    header: 'Inputs',
    cell: (info) => (
      <div className="min-w-0">
        <code className="block truncate text-xs text-muted-foreground">
          {formatInputPreview(info.getValue())}
        </code>
      </div>
    ),
  }),
  columnHelper.accessor('startTime', {
    header: 'Started',
    cell: (info) => (
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className={ICON_SIZES.xs} />
          {formatRelativeTime(info.getValue())}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('duration', {
    header: 'Duration',
    cell: (info) => (
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className={ICON_SIZES.xs} />
          {formatDuration(info.getValue())}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('rowCount', {
    header: 'Rows',
    cell: (info) => (
      <div className="text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Database className={ICON_SIZES.xs} />
          {info.getValue() != null ? `${formatNumber(info.getValue()!)} rows` : '-'}
        </span>
      </div>
    ),
  }),
  columnHelper.display({
    id: 'meta',
    header: () => <div className="text-right">Meta</div>,
    cell: ({ row }) => (
      <div className="flex justify-end gap-2">
        {row.original.tenantId && <TenantBadge tenantId={row.original.tenantId} />}
        {row.original.error && (
          <AlertCircle className={cn(ICON_SIZES.md, 'text-destructive')} />
        )}
      </div>
    ),
  }),
];
