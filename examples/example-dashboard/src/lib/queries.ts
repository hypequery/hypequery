import { createQueryBuilder, CrossFilter, } from "@hypequery/core"
import { IntrospectedSchema } from "@/generated/generated-schema"
import { DateRange } from "react-day-picker"
import { startOfDay, endOfDay, format } from "date-fns"

const db = createQueryBuilder<IntrospectedSchema>({
  host: typeof window !== 'undefined' ? `${window.location.origin}/clickhouse` : 'http://localhost:3000/clickhouse',
  username: "default",
  password: "",
  database: "default",
})

interface DateFilters {
  pickupDateRange?: DateRange
  dropoffDateRange?: DateRange
}

function formatDateTime(date: Date) {
  return format(date, "yyyy-MM-dd HH:mm:ss")
}

// Function to check data ranges
export async function checkDataRanges(filters: DateFilters = {}) {
  // First get the full range without filters
  const fullRangeQuery = db.table("trips")
  const fullRange = await fullRangeQuery
    .min('pickup_datetime', 'min_pickup')
    .max('pickup_datetime', 'max_pickup')
    .min('dropoff_datetime', 'min_dropoff')
    .max('dropoff_datetime', 'max_dropoff')
    .execute()


  // Then get the filtered range if filters are applied
  if (filters.pickupDateRange || filters.dropoffDateRange) {
    const query = db.table("trips")
    const filter = createFilter(filters)
    query.applyCrossFilters(filter)

    const result = await query
      .min('pickup_datetime', 'min_pickup')
      .max('pickup_datetime', 'max_pickup')
      .min('dropoff_datetime', 'min_dropoff')
      .max('dropoff_datetime', 'max_dropoff')
      .execute()

    return result[0]
  }

  return fullRange[0]
}

function createFilter(filters: DateFilters) {
  const filter = new CrossFilter()

  if (filters.pickupDateRange?.from) {
    filter.add({
      column: 'pickup_datetime',
      operator: 'gte',
      value: formatDateTime(startOfDay(filters.pickupDateRange.from))
    })

    if (filters.pickupDateRange.to) {
      filter.add({
        column: 'pickup_datetime',
        operator: 'lte',
        value: formatDateTime(endOfDay(filters.pickupDateRange.to))
      })
    }
  }

  if (filters.dropoffDateRange?.from) {
    filter.add({
      column: 'dropoff_datetime',
      operator: 'gte',
      value: formatDateTime(startOfDay(filters.dropoffDateRange.from))
    })

    if (filters.dropoffDateRange.to) {
      filter.add({
        column: 'dropoff_datetime',
        operator: 'lte',
        value: formatDateTime(endOfDay(filters.dropoffDateRange.to))
      })
    }
  }

  return filter
}

export async function fetchAverageAmounts(filters: DateFilters = {}) {
  const query = db.table("trips")
  const filter = createFilter(filters)
  query.applyCrossFilters(filter)


  const sql = await query
    .avg("total_amount")
    .avg("tip_amount")
    .avg("tolls_amount")
    .avg("fare_amount")
    .toSQL()

  console.log({ sql })

  const result = await query
    .avg("total_amount")
    .avg("tip_amount")
    .avg("tolls_amount")
    .avg("fare_amount")
    .execute()

  console.log({ result })
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

export async function fetchTripStats(filters: DateFilters = {}) {
  const query = db.table("trips")
  const filter = createFilter(filters)
  query.applyCrossFilters(filter)

  const result = await query
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

export const fetchMonthlyTripCounts = async (filters: DateFilters = {}) => {
  console.log('Fetching monthly trip counts...');

  const query = db.table("trips")
  const filter = createFilter(filters)
  query.applyCrossFilters(filter)

  const result = await query
    .select(['toStartOfWeek(pickup_datetime) as week'])
    .count('trip_id', 'trip_count')
    .execute();

  return result.map(row => ({
    name: new Date(row.week).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    value: Number(row.trip_count)
  }));
}; 