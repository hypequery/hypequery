"use client"

import { useFilters } from "@/lib/filters-context"
import { Card } from "@/components/ui/card"
import { AreaChartComponent } from "@/components/charts/area-chart"
import { TripsDataTable } from "@/components/trips-data-table"
import { useHypequeryQuery } from "@/lib/hypequery-client"
import { buildFilterInput } from "@/lib/filter-utils"

export default function Home() {
  const { pickupDateRange, dropoffDateRange } = useFilters()
  const filters = buildFilterInput(pickupDateRange, dropoffDateRange)

  const {
    data: averageAmounts,
    isLoading: isLoadingAmounts,
  } = useHypequeryQuery('averageAmounts', filters)

  const {
    data: tripStats,
    isLoading: isLoadingStats,
  } = useHypequeryQuery('tripStats', filters)

  const {
    data: weeklyTripCounts,
    isLoading: isLoadingWeekly,
    error: weeklyError,
  } = useHypequeryQuery('weeklyTripCounts', filters)

  const chartData = (weeklyTripCounts ?? []).map(({ name, value }) => ({
    month: new Date(name).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    desktop: value
  }))

  return (
    <main className="p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-2">Average Trip Amount</h3>
          {isLoadingAmounts ? (
            <p>Loading...</p>
          ) : (
            <div className="space-y-2">
              <p>Total: ${averageAmounts?.total.toFixed(2)}</p>
              <p>Tips: ${averageAmounts?.tips.toFixed(2)}</p>
              <p>Tolls: ${averageAmounts?.tolls.toFixed(2)}</p>
              <p>Fare: ${averageAmounts?.fare.toFixed(2)}</p>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-2">Average Trip Distance</h3>
          {isLoadingStats ? (
            <p>Loading...</p>
          ) : (
            <p>{tripStats?.avgDistance.toFixed(2)} miles</p>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-2">Average Passengers</h3>
          {isLoadingStats ? (
            <p>Loading...</p>
          ) : (
            <p>{tripStats?.avgPassengers.toFixed(2)} passengers</p>
          )}
        </Card>
      </div>

      {isLoadingWeekly ? (
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Weekly Trip Volume</h3>
          <p>Loading...</p>
        </Card>
      ) : weeklyError ? (
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Weekly Trip Volume</h3>
          <p className="text-red-500">Error loading trip counts: {weeklyError.message}</p>
        </Card>
      ) : weeklyTripCounts && weeklyTripCounts.length > 0 ? (
        <AreaChartComponent
          data={chartData}
          title="Weekly Trip Volume"
          description="Showing total trips per week"
        />
      ) : (
        <Card className="p-4">
          <h3 className="text-lg font-semibold mb-4">Weekly Trip Volume</h3>
          <p>No data available for the selected date range</p>
        </Card>
      )}

      <Card className="p-4">
        <TripsDataTable />
      </Card>
    </main>
  )
}
