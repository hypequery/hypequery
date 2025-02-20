import { createQueryBuilder } from "@hypequery/core"
import { IntrospectedSchema } from "@/generated/generated-schema"

const db = createQueryBuilder<IntrospectedSchema>({
  host: typeof window !== 'undefined' ? `${window.location.origin}/clickhouse` : 'http://localhost:3000/clickhouse',
  username: "default",
  password: "",
  database: "default",
})

export async function fetchAverageAmounts() {
  const result = await db
    .table("trips")
    .avg("total_amount")
    .avg("tip_amount")
    .avg("tolls_amount")
    .avg("fare_amount")
    .execute()

  if (!result.length) {
    throw new Error("No data found")
  }

  return {
    total: Number(result[0].total_amount_avg),
    tips: Number(result[0].tip_amount_avg),
    tolls: Number(result[0].tolls_amount_avg),
    fare: Number(result[0].fare_amount_avg),
  }
}

export async function fetchTripStats() {
  const result = await db
    .table("trips")
    .avg("trip_distance")
    .avg("passenger_count")
    .execute()

  if (!result.length) {
    throw new Error("No data found")
  }

  return {
    avgDistance: Number(result[0].trip_distance_avg),
    avgPassengers: Number(result[0].passenger_count_avg),
  }
} 