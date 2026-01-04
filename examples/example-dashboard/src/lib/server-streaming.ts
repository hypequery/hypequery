import 'server-only';

import { createQueryBuilder } from '@hypequery/clickhouse';
import { IntrospectedSchema } from '@/generated/generated-schema';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST ?? process.env.NEXT_PUBLIC_CLICKHOUSE_HOST;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? process.env.NEXT_PUBLIC_CLICKHOUSE_USER;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD;
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DATABASE ?? process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE;

function ensureEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getServerDb() {
  return createQueryBuilder<IntrospectedSchema>({
    host: ensureEnv(CLICKHOUSE_HOST, 'CLICKHOUSE_HOST'),
    username: ensureEnv(CLICKHOUSE_USER, 'CLICKHOUSE_USER'),
    password: ensureEnv(CLICKHOUSE_PASSWORD, 'CLICKHOUSE_PASSWORD'),
    database: ensureEnv(CLICKHOUSE_DB, 'CLICKHOUSE_DATABASE'),
  });
}

export interface ServerStreamingSummary {
  totalRows: number;
  totalBatches: number;
  durationMs: number;
  totals: {
    fare: number;
    distance: number;
    tips: number;
  };
  averages: {
    fare: number;
    distance: number;
    tips: number;
  };
  sampleRows: Array<{
    trip_id: string;
    pickup_datetime: string;
    dropoff_datetime: string;
    trip_distance: number;
    total_amount: number;
    tip_amount: number;
    passenger_count: number;
    payment_type: string;
  }>;
  logs: string[];
}

interface ServerStreamOptions {
  limit?: number;
  sampleSize?: number;
}

export async function streamTripsOnServer({ limit = 10000, sampleSize = 20 }: ServerStreamOptions = {}): Promise<ServerStreamingSummary> {
  const db = getServerDb();
  const query = db.table('trips')
    .select([
      'trip_id',
      'pickup_datetime',
      'dropoff_datetime',
      'trip_distance',
      'passenger_count',
      'fare_amount',
      'tip_amount',
      'total_amount',
      'payment_type'
    ])
    .orderBy('pickup_datetime', 'DESC')
    .limit(limit);

  const sampleRows: ServerStreamingSummary['sampleRows'] = [];
  const logs: string[] = [];
  let totalRows = 0;
  let totalBatches = 0;
  let fareTotal = 0;
  let distanceTotal = 0;
  let tipTotal = 0;

  const start = Date.now();

  const stream = await query.stream();
  const processBatch = (rows: any[]) => {
    totalBatches += 1;
    const message = `Processed batch #${totalBatches} (${rows.length} rows)`;
    console.log('[server-stream]', message);
    logs.push(message);

    for (const row of rows) {
      totalRows += 1;
      const normalized = {
        trip_id: String(row.trip_id),
        pickup_datetime: String(row.pickup_datetime),
        dropoff_datetime: String(row.dropoff_datetime),
        trip_distance: Number(row.trip_distance) || 0,
        total_amount: Number(row.total_amount) || 0,
        tip_amount: Number(row.tip_amount) || 0,
        passenger_count: Number(row.passenger_count) || 0,
        payment_type: String(row.payment_type)
      };

      fareTotal += normalized.total_amount;
      distanceTotal += normalized.trip_distance;
      tipTotal += normalized.tip_amount;

      if (sampleRows.length < sampleSize) {
        sampleRows.push(normalized);
      }
    }
  };

  if (typeof (stream as ReadableStream<any[]> | undefined)?.getReader === 'function') {
    console.log('[server-stream]', 'Using Web ReadableStream reader');
    logs.push('Using Web ReadableStream reader');
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        processBatch(value);
      }
    }
  } else if (typeof (stream as any)?.[Symbol.asyncIterator] === 'function') {
    console.log('[server-stream]', 'Using async iterator stream');
    logs.push('Using async iterator stream');
    for await (const rows of stream) {
      if (rows?.length) {
        processBatch(rows);
      }
    }
  } else {
    throw new Error('Unsupported stream type returned from query.stream()');
  }

  const durationMs = Date.now() - start;
  const safeAverage = (total: number) => totalRows ? total / totalRows : 0;

  return {
    totalRows,
    totalBatches,
    durationMs,
    totals: {
      fare: fareTotal,
      distance: distanceTotal,
      tips: tipTotal
    },
    averages: {
      fare: safeAverage(fareTotal),
      distance: safeAverage(distanceTotal),
      tips: safeAverage(tipTotal)
    },
    sampleRows,
    logs
  };
}
