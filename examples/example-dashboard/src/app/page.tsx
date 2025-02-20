"use client"

import { useEffect, useState } from "react"
import { createQueryBuilder } from "@hypequery/core"
import { KPICard } from "@/components/ui/kpi-card"
import { IntrospectedSchema } from "@/generated/generated-schema"

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.NEXT_PUBLIC_CLICKHOUSE_HOST || "http://localhost:8123",
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USER || "default",
  password: process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD,
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE || "default",
})

export default function Page() {
  const [loading, setLoading] = useState(true)
  const [averageAmounts, setAverageAmounts] = useState<{
    total: number
    tips: number
    tolls: number
    fare: number
  }>({
    total: 0,
    tips: 0,
    tolls: 0,
    fare: 0,
  })
  const [tripStats, setTripStats] = useState<{
    avgDistance: number
    avgPassengers: number
  }>({
    avgDistance: 0,
    avgPassengers: 0,
  })

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch average amounts
        const amountsResult = await db
          .table("trips")
          .avg("total_amount")
          .avg("tip_amount")
          .avg("tolls_amount")
          .avg("fare_amount")
          .execute()

        if (amountsResult.length > 0) {
          setAverageAmounts({
            total: Number(amountsResult[0].total_amount_avg),
            tips: Number(amountsResult[0].tip_amount_avg),
            tolls: Number(amountsResult[0].tolls_amount_avg),
            fare: Number(amountsResult[0].fare_amount_avg),
          })
        }

        // Fetch trip statistics
        const tripStatsResult = await db
          .table("trips")
          .avg("trip_distance")
          .avg("passenger_count")
          .execute()

        if (tripStatsResult.length > 0) {
          setTripStats({
            avgDistance: Number(tripStatsResult[0].trip_distance_avg),
            avgPassengers: Number(tripStatsResult[0].passenger_count_avg),
          })
        }

        setLoading(false)
      } catch (error) {
        console.error("Error fetching data:", error)
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Average Trip Amount"
          value={`$${averageAmounts.total.toFixed(2)}`}
          loading={loading}
          subValues={[
            { label: "Tips", value: `$${averageAmounts.tips.toFixed(2)}` },
            { label: "Tolls", value: `$${averageAmounts.tolls.toFixed(2)}` },
            { label: "Fare", value: `$${averageAmounts.fare.toFixed(2)}` },
          ]}
        />

        <KPICard
          title="Average Trip Distance"
          value={`${tripStats.avgDistance.toFixed(2)} miles`}
          loading={loading}
        />

        <KPICard
          title="Average Passengers"
          value={tripStats.avgPassengers.toFixed(1)}
          loading={loading}
        />
      </div>
    </div>
  )
}
