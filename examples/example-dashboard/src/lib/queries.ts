import { createQueryBuilder, CrossFilter, logger } from "@hypequery/clickhouse"
import { DateRange } from "react-day-picker"
import { startOfDay, endOfDay, format } from "date-fns"
import { IntrospectedSchema } from "@/generated/generated-schema"

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.NEXT_PUBLIC_CLICKHOUSE_HOST!,
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USER,
  password: process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD,
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE,
})

// Configure logger to show detailed info
logger.configure({
  level: 'debug',
  enabled: true,
});

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

  const result = await query
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

export const fetchWeeklyTripCounts = async (filters: DateFilters = {}) => {

  const query = db.table("trips")
  const filter = createFilter(filters)
  query.applyCrossFilters(filter)

  const result = await query
    //@ts-ignore - requires fix in hypqeury package
    .select(['toStartOfWeek(pickup_datetime) as week'])
    .count('trip_id', 'trip_count')
    .execute();

  return result.map(row => ({
    //@ts-ignore - requires fix in hypqeury package
    name: new Date(row.week).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    value: Number(row.trip_count)
  }));
};

export async function fetchTrips(filters: DateFilters = {}, { pageSize = 10, after, before }: { pageSize?: number; after?: string; before?: string } = {}) {
  const query = db.table("trips")
  const filter = createFilter(filters)
  query.applyCrossFilters(filter)

  const result = await query
    .select([
      "pickup_datetime",
      "dropoff_datetime",
      "trip_distance",
      "passenger_count",
      "fare_amount",
      "tip_amount",
      "total_amount",
      "payment_type",
    ])
    .orderBy("pickup_datetime", "DESC")
    .paginate({
      pageSize,
      after,
      before,
      orderBy: [{ column: "pickup_datetime", direction: "DESC" }]
    })

  return {
    ...result,
    data: result.data.map(row => ({
      ...row,
      trip_distance: Number(row.trip_distance),
      passenger_count: Number(row.passenger_count),
      fare_amount: Number(row.fare_amount),
      tip_amount: Number(row.tip_amount),
      total_amount: Number(row.total_amount),
    }))
  }
}

/**
 * Fetch trips data using streaming for efficient memory usage and performance.
 * This function demonstrates the streaming capability with hypequery's built-in logging.
 */
export async function fetchTripsByStreaming(
  filters: DateFilters = {},
  options: {
    limit?: number,
    onProgress?: (count: number, newRows?: any[]) => void,
    onLog?: (logMessage: string) => void
  } = {}
) {
  const { limit, onProgress, onLog } = options;
  const logs: string[] = [];

  // Function to log messages both to console and collect for UI
  const logMessage = (message: string) => {
    logs.push(message);
    if (onLog) {
      onLog(message);
    }
  };

  logMessage('🚀 Starting streaming query for trips data...');

  logger.configure({
    level: 'debug',
    enabled: true,
    onQueryLog: (log) => {
      if (log.status === 'started') {
        logMessage(`🔍 Query started at ${new Date(log.startTime || 0).toLocaleTimeString()}`);
      } else if (log.status === 'completed') {
        logMessage(`✅ Query completed in ${log.duration || 0}ms with ${log.rowCount || 'unknown'} rows`);
      } else if (log.status === 'error') {
        logMessage(`❌ Query failed: ${log.error?.message || 'Unknown error'}`);
      }
    }
  });

  try {
    // Create the base query
    const query = db.table('trips')
      .select([
        'trip_id',
        'pickup_datetime',
        'dropoff_datetime',
        'pickup_longitude',
        'pickup_latitude',
        'dropoff_longitude',
        'dropoff_latitude',
        'passenger_count',
        'trip_distance',
        'fare_amount',
        'tip_amount',
        'total_amount',
        'payment_type'
      ]);

    // Apply filters
    const filter = createFilter(filters);
    query.applyCrossFilters(filter);

    // Apply limit if provided (removing this allows unlimited rows)
    if (limit) {
      query.limit(limit);
    }

    // Track processing stats for batches and UI updates
    let totalProcessed = 0;
    let batchCount = 0;

    // Get the stream
    const stream = await query.stream();
    const reader = stream.getReader();

    // Process the stream
    while (true) {
      const { done, value: rows } = await reader.read();
      if (done) break;

      batchCount++;
      totalProcessed += rows.length;

      // Log batch progress
      logMessage(`📦 Processing batch #${batchCount} with ${rows.length} rows (total: ${totalProcessed})`);

      // Process this batch of rows using the json() method
      const processedRows = rows.map((row: any) => {
        // Log the first row data structure in the first batch for debugging
        if (batchCount === 1 && rows.indexOf(row) === 0) {
          logMessage(`🔍 Raw row data structure: ${JSON.stringify(row).substring(0, 100)}...`);
        }

        // Use the json() method to get the structured data
        const rowData = row.json ? row.json() : row;

        // Log the parsed data for debugging
        if (batchCount === 1 && rows.indexOf(row) === 0) {
          logMessage(`🔍 Parsed row data: ${JSON.stringify(rowData).substring(0, 100)}...`);
        }

        // Ensure numeric values are actually numbers
        const safeNumber = (value: any) => {
          const num = Number(value);
          return isNaN(num) ? 0 : num;
        };

        return {
          ...rowData,
          trip_distance: safeNumber(rowData.trip_distance),
          passenger_count: safeNumber(rowData.passenger_count),
          fare_amount: safeNumber(rowData.fare_amount),
          tip_amount: safeNumber(rowData.tip_amount),
          total_amount: safeNumber(rowData.total_amount),
        };
      });

      // Report progress with the new batch of rows
      if (onProgress) {
        onProgress(totalProcessed, processedRows);
      }
    }

    logMessage(`✅ Streaming complete. Processed ${totalProcessed} rows in ${batchCount} batches.`);
    return { totalRows: totalProcessed, logs };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logMessage(`❌ Error in streaming query: ${errorMessage}`);
    throw error;
  }
}
