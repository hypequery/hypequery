import { db } from '@/analytics/client';

export const runtime = 'nodejs';

export async function GET() {
  const stream = await db
    .table('trips')
    .select([
      'pickup_datetime',
      'dropoff_datetime',
      'trip_distance',
      'fare_amount',
      'total_amount',
    ])
    .limit(50)
    .stream();

  const encoder = new TextEncoder();
  const transform = new TransformStream<any[], Uint8Array>({
    transform(rows, controller) {
      for (const row of rows) {
        controller.enqueue(encoder.encode(`${JSON.stringify(row)}\n`));
      }
    },
  });

  return new Response(stream.pipeThrough(transform), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
