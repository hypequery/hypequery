import RefreshButton from '@/components/cache-demo/refresh-button';
import InvalidateButton from '@/components/cache-demo/invalidate-button';
import { Card } from '@/components/ui/card';
import { api } from '@/analytics/queries';

export const dynamic = 'force-dynamic';

export default async function CacheDemoPage() {
  const { summary, cacheStatus } = await api.execute('cachedSummary');

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Cache Demo</h1>
        <p className="text-gray-500">
          The data below comes from a cached query. Use the buttons to refresh or invalidate the cache
          and watch the stats change (first request → miss, subsequent → hit/stale-hit).
        </p>
      </div>

      <div className="flex gap-4">
        <RefreshButton />
        <InvalidateButton />
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <p className="text-sm text-gray-500">Average Amounts</p>
          <p className="text-2xl font-semibold">${summary.total.toFixed(2)}</p>
          <p className="text-sm text-gray-500">
            Tips: ${summary.tips.toFixed(2)} • Tolls: ${summary.tolls.toFixed(2)} • Fare: ${summary.fare.toFixed(2)}
          </p>
        </div>
        <div className="text-sm">
          <p className="text-gray-500 mb-1">Last request status</p>
          <p className="font-mono text-lg capitalize">{cacheStatus}</p>
          <p className="text-xs text-gray-500 mt-2">
            (Stats are cumulative since the server started; use the buttons above to trigger new misses/hits.)
          </p>
        </div>
      </Card>
    </div>
  );
}
