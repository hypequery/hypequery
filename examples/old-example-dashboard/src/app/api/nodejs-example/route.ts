import { NextRequest, NextResponse } from 'next/server';
import { createQueryBuilder, raw } from '@hypequery/clickhouse';
import { IntrospectedSchema } from '@/generated/generated-schema';

function getDb() {
  // Initialize the query builder
  return createQueryBuilder<IntrospectedSchema>({
    host: process.env.NEXT_PUBLIC_CLICKHOUSE_HOST!,
    username: process.env.NEXT_PUBLIC_CLICKHOUSE_USER,
    password: process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD,
    database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE,
  });

}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const page = parseInt(searchParams.get('page') || '1');
    const offset = (page - 1) * limit;

    const db = getDb();

    // Get total count for pagination
    const countResult = await db.table('trips')
      .count('trip_id', 'total_count')
      .execute();

    const totalCount = Number(countResult[0]?.total_count || 0);

    // Get paginated data
    const result = await db.table('trips')
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
      .limit(limit)
      .offset(offset)
      .execute();

    // Get some aggregated stats
    const statsResult = await db.table('trips')
      .avg('total_amount', 'avg_total')
      .avg('trip_distance', 'avg_distance')
      .avg('passenger_count', 'avg_passengers')
      .count('trip_id', 'total_trips')
      .execute();

    const stats = {
      avgTotalAmount: Number(statsResult[0]?.avg_total || 0),
      avgDistance: Number(statsResult[0]?.avg_distance || 0),
      avgPassengers: Number(statsResult[0]?.avg_passengers || 0),
      totalTrips: Number(statsResult[0]?.total_trips || 0)
    };

    // Get weekly trip counts for chart (simplified to avoid TypeScript issues)
    const weeklyResult = await db.table('trips')
      .select([
        'pickup_datetime'
      ])
      .limit(1000)
      .execute();

    // Process weekly data in JavaScript
    const weeklyMap = new Map<string, number>();
    weeklyResult.forEach(row => {
      const date = new Date(row.pickup_datetime);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
      const weekKey = weekStart.toISOString().split('T')[0];
      weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + 1);
    });

    const weeklyData = Array.from(weeklyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 12)
      .map(([week, count]) => ({
        week,
        count
      }));

    return NextResponse.json({
      success: true,
      data: {
        trips: result.map(row => ({
          ...row,
          trip_distance: Number(row.trip_distance),
          passenger_count: Number(row.passenger_count),
          fare_amount: Number(row.fare_amount),
          tip_amount: Number(row.tip_amount),
          total_amount: Number(row.total_amount),
        })),
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1
        },
        stats,
        weeklyData
      },
      meta: {
        client: 'Node.js (@clickhouse/client)',
        environment: 'Server-side API route',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Node.js API route error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        meta: {
          client: 'Node.js (@clickhouse/client)',
          environment: 'Server-side API route'
        }
      },
      { status: 500 }
    );
  }
} 