import { X, Copy, Clock, Zap, Database, Server, AlertCircle, CheckCircle } from 'lucide-react';
import { cn, formatDuration, formatTime, formatNumber } from '@/lib/utils';
import { SQLViewer } from './SQLViewer';
import { StatusBadge } from './StatusBadge';
import type { QueryHistoryEntry } from '@/lib/types';

interface QueryDetailProps {
  query: QueryHistoryEntry;
  onClose?: () => void;
}

/**
 * Detailed view of a single query.
 */
export function QueryDetail({ query, onClose }: QueryDetailProps) {
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <StatusBadge status={query.status} />
          {query.endpointKey && (
            <span className="text-sm font-medium text-primary">
              {query.endpointKey}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* SQL Query */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">SQL Query</h3>
            <button
              onClick={() => copyToClipboard(query.query)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
          </div>
          <SQLViewer sql={query.query} showLineNumbers maxHeight="300px" />
        </section>

        {/* Metrics */}
        <section>
          <h3 className="text-sm font-medium mb-3">Metrics</h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={Clock}
              label="Start Time"
              value={formatTime(query.startTime)}
            />
            <MetricCard
              icon={Zap}
              label="Duration"
              value={formatDuration(query.duration)}
              highlight={query.duration !== undefined && query.duration > 1000}
            />
            <MetricCard
              icon={Database}
              label="Row Count"
              value={formatNumber(query.rowCount)}
            />
            <MetricCard
              icon={Server}
              label="Cache Status"
              value={query.cacheHit ? 'Hit' : 'Miss'}
              highlight={query.cacheHit}
              highlightColor="green"
            />
          </div>
        </section>

        {/* Cache Info */}
        {query.cacheHit && query.cacheAgeMs !== undefined && (
          <section>
            <h3 className="text-sm font-medium mb-2">Cache Details</h3>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-md p-3 text-sm">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>Served from cache ({formatDuration(query.cacheAgeMs)} old)</span>
              </div>
            </div>
          </section>
        )}

        {/* Error */}
        {query.error && (
          <section>
            <h3 className="text-sm font-medium mb-2">Error</h3>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-md p-3">
              <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <pre className="text-sm whitespace-pre-wrap break-words font-mono">
                  {query.error}
                </pre>
              </div>
            </div>
          </section>
        )}

        {/* Result Preview */}
        {query.resultPreview && query.resultPreview.length > 0 && (
          <section>
            <h3 className="text-sm font-medium mb-2">Result Preview</h3>
            <div className="bg-muted rounded-md overflow-auto max-h-[300px]">
              <table className="w-full text-sm">
                <thead className="bg-muted-foreground/10 sticky top-0">
                  <tr>
                    {Object.keys(query.resultPreview[0] as object).map((key) => (
                      <th
                        key={key}
                        className="px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.resultPreview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {Object.values(row as object).map((value, j) => (
                        <td key={j} className="px-3 py-2 font-mono">
                          {formatCellValue(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Meta Info */}
        <section>
          <h3 className="text-sm font-medium mb-2">Details</h3>
          <dl className="text-sm space-y-1">
            <div className="flex">
              <dt className="w-24 text-muted-foreground">Query ID</dt>
              <dd className="font-mono text-xs">{query.queryId}</dd>
            </div>
            {query.endpointPath && (
              <div className="flex">
                <dt className="w-24 text-muted-foreground">Endpoint</dt>
                <dd className="font-mono text-xs">{query.endpointPath}</dd>
              </div>
            )}
            {query.createdAt && (
              <div className="flex">
                <dt className="w-24 text-muted-foreground">Created</dt>
                <dd>{formatTime(query.createdAt)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}

/**
 * Metric card component.
 */
function MetricCard({
  icon: Icon,
  label,
  value,
  highlight = false,
  highlightColor = 'yellow',
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  highlight?: boolean;
  highlightColor?: 'yellow' | 'green' | 'red';
}) {
  const highlightStyles = {
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  };

  return (
    <div
      className={cn(
        'rounded-md p-3',
        highlight ? highlightStyles[highlightColor] : 'bg-muted'
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

/**
 * Format cell value for display.
 */
function formatCellValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default QueryDetail;
