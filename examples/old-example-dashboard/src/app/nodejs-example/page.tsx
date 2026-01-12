"use client"

import { useQuery } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { AreaChartComponent } from "@/components/charts/area-chart"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import type { IntrospectedSchema } from '@/generated/generated-schema'
import type { TableRecord } from '@hypequery/clickhouse'

interface NodeJSData {
  trips: Array<Pick<TableRecord<IntrospectedSchema['trips']>,
    'trip_id' | 'pickup_datetime' | 'dropoff_datetime' | 'trip_distance' |
    'passenger_count' | 'fare_amount' | 'tip_amount' | 'total_amount' | 'payment_type'>>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
  stats: {
    avgTotalAmount: number
    avgDistance: number
    avgPassengers: number
    totalTrips: number
  }
  weeklyData: Array<{
    week: string
    count: number
  }>
}

interface NodeJSResponse {
  success: boolean
  data: NodeJSData
  meta: {
    client: string
    environment: string
    timestamp: string
    clientInfo?: {
      type: string
      constructorName: string
      isNode: boolean
    }
  }
}

async function fetchNodeJSData(page: number = 1, limit: number = 10): Promise<NodeJSResponse> {
  const response = await fetch(`/api/nodejs-example?page=${page}&limit=${limit}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export default function NodeJSExample() {
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['nodejs-example', page, limit],
    queryFn: () => fetchNodeJSData(page, limit),
    refetchInterval: false
  });

  const chartData = data?.data.weeklyData?.map(({ week, count }) => ({
    month: new Date(week).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    desktop: count
  })) || [];

  if (error) {
    return (
      <main className="p-4 space-y-4">
        <Card className="p-6">
          <h1 className="text-2xl font-bold mb-4">Node.js Example Dashboard</h1>
          <div className="text-red-500 mb-4">
            Error loading data: {error.message}
          </div>
          <Button onClick={() => refetch()}>Retry</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="p-4 space-y-4">
      <Card className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2">Node.js Example Dashboard</h1>
            <p className="text-gray-600">
              Data fetched from server-side API route using @clickhouse/client
            </p>
          </div>
          <div className="text-sm text-gray-500">
            <div>Client: {data?.meta.client}</div>
            <div>Environment: {data?.meta.environment}</div>
            <div>Timestamp: {data?.meta.timestamp}</div>
            {data?.meta.clientInfo && (
              <>
                <div>Client Type: {data.meta.clientInfo.type}</div>
                <div>Constructor: {data.meta.clientInfo.constructorName}</div>
                <div>Node.js: {data.meta.clientInfo.isNode ? 'Yes' : 'No'}</div>
              </>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <p>Loading Node.js data...</p>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card className="p-4">
                <h3 className="text-lg font-semibold mb-2">Total Trips</h3>
                <p className="text-2xl font-bold">{data?.data.stats.totalTrips.toLocaleString()}</p>
              </Card>

              <Card className="p-4">
                <h3 className="text-lg font-semibold mb-2">Avg Trip Amount</h3>
                <p className="text-2xl font-bold">${data?.data.stats.avgTotalAmount.toFixed(2)}</p>
              </Card>

              <Card className="p-4">
                <h3 className="text-lg font-semibold mb-2">Avg Distance</h3>
                <p className="text-2xl font-bold">{data?.data.stats.avgDistance.toFixed(2)} miles</p>
              </Card>

              <Card className="p-4">
                <h3 className="text-lg font-semibold mb-2">Avg Passengers</h3>
                <p className="text-2xl font-bold">{data?.data.stats.avgPassengers.toFixed(1)}</p>
              </Card>
            </div>

            {/* Weekly Chart */}
            {chartData.length > 0 && (
              <Card className="p-4 mb-6">
                <AreaChartComponent
                  data={chartData}
                  title="Weekly Trip Volume (Node.js)"
                  description="Data processed server-side using @clickhouse/client"
                />
              </Card>
            )}

            {/* Trips Table */}
            <Card className="p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Recent Trips</h3>
                <div className="text-sm text-gray-500">
                  Page {data?.data.pagination.page} of {data?.data.pagination.totalPages}
                  {' '}({data?.data.pagination.total.toLocaleString()} total)
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Trip ID</th>
                      <th className="text-left p-2">Pickup</th>
                      <th className="text-left p-2">Distance</th>
                      <th className="text-left p-2">Passengers</th>
                      <th className="text-left p-2">Total Amount</th>
                      <th className="text-left p-2">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.data.trips.map((trip) => (
                      <tr key={trip.trip_id} className="border-b hover:bg-gray-50">
                        <td className="p-2 font-mono text-xs">{trip.trip_id}</td>
                        <td className="p-2">
                          {new Date(trip.pickup_datetime).toLocaleDateString()}
                        </td>
                        <td className="p-2">{trip.trip_distance.toFixed(2)} miles</td>
                        <td className="p-2">{trip.passenger_count}</td>
                        <td className="p-2">${trip.total_amount.toFixed(2)}</td>
                        <td className="p-2">{trip.payment_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex justify-between items-center mt-4">
                <Button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={!data?.data.pagination.hasPrev}
                  variant="outline"
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {data?.data.pagination.page} of {data?.data.pagination.totalPages}
                </span>
                <Button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!data?.data.pagination.hasNext}
                  variant="outline"
                >
                  Next
                </Button>
              </div>
            </Card>
          </>
        )}
      </Card>
    </main>
  );
} 