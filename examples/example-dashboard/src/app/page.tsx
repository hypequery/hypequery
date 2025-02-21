"use client"

import { useQuery } from "@tanstack/react-query"
import { fetchAverageAmounts, fetchTripStats, fetchMonthlyTripCounts } from "@/lib/queries"
import { useFilters } from "@/lib/filters-context"
import { Card } from "@/components/ui/card"
import { format } from "date-fns"
import { MonthlyTripsChart } from "@/components/monthly-trips-chart"

export default function Home() {
  const { pickupDateRange, dropoffDateRange } = useFilters()

  const { data: averageAmounts, isLoading: isLoadingAmounts } = useQuery({
    queryKey: ['averageAmounts', pickupDateRange, dropoffDateRange],
    queryFn: () => fetchAverageAmounts({ pickupDateRange, dropoffDateRange })
  })

  const { data: tripStats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['tripStats', pickupDateRange, dropoffDateRange],
    queryFn: () => fetchTripStats({ pickupDateRange, dropoffDateRange })
  })

  const { data: monthlyTripCounts, isLoading: isLoadingMonthly, error: monthlyError } = useQuery({
    queryKey: ['monthlyTripCounts', pickupDateRange, dropoffDateRange],
    queryFn: () => fetchMonthlyTripCounts({ pickupDateRange, dropoffDateRange })
  })

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

      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">Monthly Trip Volume</h3>
        {isLoadingMonthly ? (
          <p>Loading...</p>
        ) : monthlyError ? (
          <p className="text-red-500">Error loading trip counts: {monthlyError.message}</p>
        ) : monthlyTripCounts && monthlyTripCounts.length > 0 ? (
          <div className="h-[400px]">
            <MonthlyTripsChart data={monthlyTripCounts} />
          </div>
        ) : (
          <p>No data available for the selected date range</p>
        )}
      </Card>
    </main>
  )
}
