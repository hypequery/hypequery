import { streamTripsOnServer } from '@/lib/server-streaming';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function ServerStreamingPage() {
  const result = await streamTripsOnServer({ limit: 5000, sampleSize: 10 });

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Server-side Streaming Demo</h1>
        <p className="text-gray-500 max-w-3xl">
          This page runs a streaming query on the server using hypequery&apos;s <code>.stream()</code> API,
          aggregates the data, and only sends summarised insights plus a small sample set to the browser.
          It pairs nicely with the client-side demo to show both halves of the streaming story.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Rows processed" value={result.totalRows.toLocaleString()} helper={`${result.totalBatches} batches`} />
        <StatCard
          label="Duration"
          value={`${result.durationMs} ms`}
          helper={`${(result.totalRows / Math.max(result.durationMs, 1) * 1000).toFixed(0)} rows/sec`}
        />
        <StatCard label="Total fare" value={`$${result.totals.fare.toFixed(2)}`} helper={`Avg $${result.averages.fare.toFixed(2)}`} />
        <StatCard label="Total distance" value={`${result.totals.distance.toFixed(2)} mi`} helper={`Avg ${result.averages.distance.toFixed(2)} mi`} />
      </div>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Server streaming workflow</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-600">
          <li>Instantiate the query builder with your server-side credentials.</li>
          <li>Call <code>.stream()</code> to receive a <code>ReadableStream</code> of JSONEachRow batches.</li>
          <li>Iterate over the stream, aggregating totals or transforming rows without buffering everything.</li>
          <li>Send just the aggregated payload (stats + samples) to the client.</li>
        </ol>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Sample streamed rows</h2>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500 border-b">
              <tr>
                <th className="py-2 pr-4">Trip</th>
                <th className="py-2 pr-4">Pickup</th>
                <th className="py-2 pr-4">Dropoff</th>
                <th className="py-2 pr-4">Distance</th>
                <th className="py-2 pr-4">Fare</th>
                <th className="py-2 pr-4">Tip</th>
                <th className="py-2">Passengers</th>
              </tr>
            </thead>
            <tbody>
              {result.sampleRows.map(row => (
                <tr key={row.trip_id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{row.trip_id}</td>
                  <td className="py-2 pr-4">{new Date(row.pickup_datetime).toLocaleString()}</td>
                  <td className="py-2 pr-4">{new Date(row.dropoff_datetime).toLocaleString()}</td>
                  <td className="py-2 pr-4">{row.trip_distance.toFixed(2)} mi</td>
                  <td className="py-2 pr-4">${row.total_amount.toFixed(2)}</td>
                  <td className="py-2 pr-4">${row.tip_amount.toFixed(2)}</td>
                  <td className="py-2">{row.passenger_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Server logs</h2>
        <p className="text-sm text-gray-500 mb-4">These messages come from the server component while it streams batches.</p>
        <div className="bg-gray-100 dark:bg-gray-900 rounded-md p-4 font-mono text-xs space-y-1 max-h-64 overflow-auto">
          {result.logs.map((log, idx) => (
            <div key={`${log}-${idx}`}>{log}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  helper?: string;
}

function StatCard({ label, value, helper }: StatCardProps) {
  return (
    <Card className="p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {helper && <p className="text-xs text-gray-400 mt-1">{helper}</p>}
    </Card>
  );
}
