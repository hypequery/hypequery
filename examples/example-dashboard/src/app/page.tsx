"use client"

import { useQuery } from "@tanstack/react-query"
import { KPICard } from "@/components/ui/kpi-card"
import { fetchAverageAmounts, fetchTripStats } from "@/lib/queries"

export default function Page() {
  const { data: averageAmounts, isLoading: isLoadingAmounts } = useQuery({
    queryKey: ['averageAmounts'],
    queryFn: fetchAverageAmounts,
  })

  const { data: tripStats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['tripStats'],
    queryFn: fetchTripStats,
  })

  const isLoading = isLoadingAmounts || isLoadingStats

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Average Trip Amount"
          value={averageAmounts ? `$${averageAmounts.total.toFixed(2)}` : '$0.00'}
          loading={isLoading}
          subValues={averageAmounts ? [
            { label: "Tips", value: `$${averageAmounts.tips.toFixed(2)}` },
            { label: "Tolls", value: `$${averageAmounts.tolls.toFixed(2)}` },
            { label: "Fare", value: `$${averageAmounts.fare.toFixed(2)}` },
          ] : undefined}
        />

        <KPICard
          title="Average Trip Distance"
          value={tripStats ? `${tripStats.avgDistance.toFixed(2)} miles` : '0.00 miles'}
          loading={isLoading}
        />

        <KPICard
          title="Average Passengers"
          value={tripStats ? tripStats.avgPassengers.toFixed(1) : '0.0'}
          loading={isLoading}
        />
      </div>
    </div>
  )
}
