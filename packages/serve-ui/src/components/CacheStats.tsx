import { Trash2, RefreshCw, TrendingUp, Target, Clock, Database } from 'lucide-react';
import { cn, formatDuration, formatNumber, formatPercentage } from '@/lib/utils';
import { useCacheStats } from '@/hooks/useCacheStats';

interface CacheStatsProps {
  className?: string;
}

/**
 * Cache statistics dashboard.
 */
export function CacheStats({ className }: CacheStatsProps) {
  const { stats, loading, error, refetch, clearCache } = useCacheStats();

  if (error) {
    return (
      <div className={cn('p-4 text-center text-destructive', className)}>
        <p>Failed to load cache stats: {error.message}</p>
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
    <div className={cn('p-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Cache Statistics</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Query cache performance metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={() => {
              if (confirm('Clear all cached data?')) {
                clearCache();
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-destructive-foreground bg-destructive hover:bg-destructive/90 rounded-md transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Clear Cache
          </button>
        </div>
      </div>

      {loading && !stats ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading cache statistics...
        </div>
      ) : stats ? (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={Target}
              label="Cache Hit Rate"
              value={formatPercentage(stats.hitRate)}
              description="Percentage of queries served from cache"
              highlight={stats.hitRate >= 0.7}
              highlightColor="green"
            />
            <StatCard
              icon={TrendingUp}
              label="Cache Hits"
              value={formatNumber(stats.hits)}
              description="Total queries served from cache"
            />
            <StatCard
              icon={Database}
              label="Cache Misses"
              value={formatNumber(stats.misses)}
              description="Queries that required database access"
            />
            <StatCard
              icon={Clock}
              label="Avg Cache Age"
              value={formatDuration(stats.avgCacheAge)}
              description="Average age of cached responses"
            />
          </div>

          {/* Visual Hit Rate */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-sm font-medium mb-4">Cache Performance</h3>
            <div className="space-y-4">
              {/* Hit rate bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span>Hit Rate</span>
                  <span className="font-medium">{formatPercentage(stats.hitRate)}</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      stats.hitRate >= 0.7
                        ? 'bg-green-500'
                        : stats.hitRate >= 0.4
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    )}
                    style={{ width: `${(stats.hitRate || 0) * 100}%` }}
                  />
                </div>
              </div>

              {/* Hits vs Misses */}
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span>Total Queries</span>
                  <span className="font-medium">{formatNumber(stats.totalQueries)}</span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div
                    className="bg-green-500 transition-all duration-500"
                    style={{
                      width: stats.totalQueries
                        ? `${(stats.hits / stats.totalQueries) * 100}%`
                        : '0%',
                    }}
                  />
                  <div
                    className="bg-red-400 transition-all duration-500"
                    style={{
                      width: stats.totalQueries
                        ? `${(stats.misses / stats.totalQueries) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span>Hits ({stats.hits})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-400 rounded-full" />
                    <span>Misses ({stats.misses})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tips */}
          {stats.hitRate < 0.5 && stats.totalQueries > 10 && (
            <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-md p-4">
              <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                Low Cache Hit Rate
              </h4>
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Consider reviewing your cache configuration. A higher TTL or adding more
                cacheable queries could improve performance.
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Stat card component.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  description,
  highlight = false,
  highlightColor = 'blue',
}: {
  icon: typeof Target;
  label: string;
  value: string;
  description: string;
  highlight?: boolean;
  highlightColor?: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const highlightStyles = {
    blue: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
    green: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
    yellow: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20',
    red: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        highlight ? highlightStyles[highlightColor] : 'border-border bg-card'
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default CacheStats;
