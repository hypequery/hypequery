import { initServe } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { toStartOfInterval } from '@hypequery/clickhouse';
import { z } from 'zod';

import { db } from './client';
import { buildCrossFilter, filtersSchema, baseFiltersSchema } from './filters';
import type { FiltersInput } from './filters';

const amountsSchema = z.object({
  total: z.number(),
  tips: z.number(),
  tolls: z.number(),
  fare: z.number(),
});

const tripStatsSchema = z.object({
  avgDistance: z.number(),
  avgPassengers: z.number(),
});

// Types for database query results
type AverageAmountsResult = {
  total_amount_avg?: number | string;
  tip_amount_avg?: number | string;
  tolls_amount_avg?: number | string;
  fare_amount_avg?: number | string;
};

type TripStatsResult = {
  trip_distance_avg?: number | string;
  passenger_count_avg?: number | string;
};

type WeeklyTripsResult = {
  week: string | Date;
  trip_count: number | string;
};

type TripRowResult = {
  pickup_datetime: string | Date;
  dropoff_datetime: string | Date;
  trip_distance: number | string;
  passenger_count: number | string;
  fare_amount: number | string;
  tip_amount: number | string;
  total_amount: number | string;
  payment_type: number | string;
};

type CountResult = {
  total_count?: number | string;
};

type WeeklyRowResult = {
  pickup_datetime: string | Date;
};

type DashboardTripResult = {
  trip_id: string | number;
  pickup_datetime: string | Date;
  dropoff_datetime: string | Date;
  trip_distance: number | string;
  passenger_count: number | string;
  fare_amount: number | string;
  tip_amount: number | string;
  total_amount: number | string;
  payment_type: number | string;
};

type DashboardStatsResult = {
  avg_total?: number | string;
  avg_distance?: number | string;
  avg_passengers?: number | string;
  total_trips?: number | string;
};

const weeklyPointSchema = z.object({
  name: z.string(),
  value: z.number(),
});

const tripsRowSchema = z.object({
  pickup_datetime: z.string(),
  dropoff_datetime: z.string(),
  trip_distance: z.number(),
  passenger_count: z.number(),
  fare_amount: z.number(),
  tip_amount: z.number(),
  total_amount: z.number(),
  payment_type: z.string(),
});

const tripsInputSchema = baseFiltersSchema.extend({
  pageSize: z.number().min(1).max(100).optional(),
  page: z.number().int().min(1).optional(),
});

const tripsOutputSchema = z.object({
  data: z.array(tripsRowSchema),
  page: z.number(),
  pageSize: z.number(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

const cacheStatsSchema = z.object({
  hits: z.number(),
  misses: z.number(),
  staleHits: z.number(),
  revalidations: z.number(),
  hitRate: z.number(),
});

const cachedSummarySchema = z.object({
  summary: amountsSchema,
  cacheStatus: z.enum(['hit', 'miss', 'stale-hit', 'bypass']),
  cacheStats: cacheStatsSchema.optional(),
});

const nodeDashboardInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
});

const nodeTripRowSchema = tripsRowSchema.extend({
  trip_id: z.union([z.string(), z.number()]).transform(String),
});

const nodeDashboardOutputSchema = z.object({
  trips: z.array(nodeTripRowSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
  stats: z.object({
    avgTotalAmount: z.number(),
    avgDistance: z.number(),
    avgPassengers: z.number(),
    totalTrips: z.number(),
  }),
  weeklyData: z.array(
    z.object({
      week: z.string(),
      count: z.number(),
    }),
  ),
});

export type AverageAmounts = z.infer<typeof amountsSchema>;
export type TripStats = z.infer<typeof tripStatsSchema>;
export type WeeklyPoint = z.infer<typeof weeklyPointSchema>;
export type TripsResult = z.infer<typeof tripsOutputSchema>;
export type CachedSummary = z.infer<typeof cachedSummarySchema>;
export type NodeDashboard = z.infer<typeof nodeDashboardOutputSchema>;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/',
});

const apiDefinition = serve({
  queries: {
    averageAmounts: query
      .describe('Average revenue components')
      .input(filtersSchema)
      .output(amountsSchema)
      .query(async ({ ctx, input }) => {
        const filter = buildCrossFilter(input as FiltersInput);
        const rows = await ctx.db
          .table('trips')
          .applyCrossFilters(filter)
          .avg('total_amount')
          .avg('tip_amount')
          .avg('tolls_amount')
          .avg('fare_amount')
          .execute();

        const result = (rows[0] ?? {}) as AverageAmountsResult;
        return {
          total: toNumber(result.total_amount_avg),
          tips: toNumber(result.tip_amount_avg),
          tolls: toNumber(result.tolls_amount_avg),
          fare: toNumber(result.fare_amount_avg),
        } satisfies AverageAmounts;
      }),
    tripStats: query
      .describe('Trip distance / passenger averages')
      .input(filtersSchema)
      .output(tripStatsSchema)
      .query(async ({ ctx, input }) => {
        const filter = buildCrossFilter(input as FiltersInput);
        const rows = await ctx.db
          .table('trips')
          .applyCrossFilters(filter)
          .avg('trip_distance')
          .avg('passenger_count')
          .execute();

        const result = (rows[0] ?? {}) as TripStatsResult;
        return {
          avgDistance: toNumber(result.trip_distance_avg),
          avgPassengers: toNumber(result.passenger_count_avg),
        } satisfies TripStats;
      }),
    weeklyTripCounts: query
      .describe('Weekly trip volume')
      .input(filtersSchema)
      .output(z.array(weeklyPointSchema))
      .query(async ({ ctx, input }) => {
        const filter = buildCrossFilter(input as FiltersInput);
        const rows = await ctx.db
          .table('trips')
          .applyCrossFilters(filter)
          .select([toStartOfInterval('pickup_datetime', '1 week', 'week')])
          .count('trip_id', 'trip_count')
          .groupBy('week')
          .execute();

        return rows.map((row) => {
          const typedRow = row as WeeklyTripsResult;
          return {
            name: new Date(typedRow.week).toISOString(),
            value: toNumber(typedRow.trip_count),
          } satisfies WeeklyPoint;
        });
      }),
    trips: query
      .describe('Paginated trip listing')
      .input(tripsInputSchema)
      .output(tripsOutputSchema)
      .query(async ({ ctx, input }) => {
        const { pageSize = 10, page = 1, ...filters } = input ?? {};
        const offset = Math.max(0, (page - 1) * pageSize);
        const requestSize = pageSize + 1;
        const filter = buildCrossFilter(filters as FiltersInput);
        const rows = await ctx.db
          .table('trips')
          .applyCrossFilters(filter)
          .select([
            'pickup_datetime',
            'dropoff_datetime',
            'trip_distance',
            'passenger_count',
            'fare_amount',
            'tip_amount',
            'total_amount',
            'payment_type',
          ])
          .orderBy('pickup_datetime', 'DESC')
          .limit(requestSize)
          .offset(offset)
          .execute();

        const mappedRows = rows.slice(0, pageSize).map((row) => {
          const typedRow = row as TripRowResult;
          return {
            pickup_datetime: String(typedRow.pickup_datetime),
            dropoff_datetime: String(typedRow.dropoff_datetime),
            trip_distance: toNumber(typedRow.trip_distance),
            passenger_count: toNumber(typedRow.passenger_count),
            fare_amount: toNumber(typedRow.fare_amount),
            tip_amount: toNumber(typedRow.tip_amount),
            total_amount: toNumber(typedRow.total_amount),
            payment_type: String(typedRow.payment_type),
          };
        });

        return {
          data: mappedRows,
          page,
          pageSize,
          hasNextPage: rows.length > pageSize,
          hasPreviousPage: page > 1,
        } satisfies TripsResult;
      }),
    cachedSummary: query
      .describe('Cached revenue summary')
      .output(cachedSummarySchema)
      .query(async ({ ctx }) => {
        const cache = ctx.db.cache;
        const before = cache?.getStats?.();
        const rows = await ctx.db
          .table('trips')
          .avg('total_amount')
          .avg('tip_amount')
          .avg('tolls_amount')
          .avg('fare_amount')
          .cache({ key: 'cached-average-amounts', tags: ['trips'] })
          .execute();
        const after = cache?.getStats?.();
        let cacheStatus: 'hit' | 'miss' | 'stale-hit' | 'bypass' = 'bypass';
        if (before && after) {
          if (after.hits > before.hits) cacheStatus = 'hit';
          else if (after.staleHits > before.staleHits) cacheStatus = 'stale-hit';
          else if (after.misses > before.misses) cacheStatus = 'miss';
        }

        const result = (rows[0] ?? {}) as AverageAmountsResult;
        return {
          summary: {
            total: toNumber(result.total_amount_avg),
            tips: toNumber(result.tip_amount_avg),
            tolls: toNumber(result.tolls_amount_avg),
            fare: toNumber(result.fare_amount_avg),
          },
          cacheStatus,
          cacheStats: after,
        } satisfies CachedSummary;
      }),
    invalidateCache: query
      .describe('Invalidate cached summary')
      .output(z.object({ success: z.literal(true) }))
      .query(async ({ ctx }) => {
        await ctx.db.cache?.invalidateTags(['trips']);
        return { success: true } as const;
      }),
    nodeDashboard: query
      .describe('Node dashboard demo payload')
      .input(nodeDashboardInputSchema)
      .output(nodeDashboardOutputSchema)
      .query(async ({ ctx, input }) => {
        const page = input?.page ?? 1;
        const limit = input?.limit ?? 10;
        const offset = (page - 1) * limit;

        const [countRows, tripRows, statsRows, weeklyRows] = await Promise.all([
          ctx.db.table('trips').count('trip_id', 'total_count').execute(),
          ctx.db
            .table('trips')
            .select([
              'trip_id',
              'pickup_datetime',
              'dropoff_datetime',
              'trip_distance',
              'passenger_count',
              'fare_amount',
              'tip_amount',
              'total_amount',
              'payment_type',
            ])
            .orderBy('pickup_datetime', 'DESC')
            .limit(limit)
            .offset(offset)
            .execute(),
          ctx.db
            .table('trips')
            .avg('total_amount', 'avg_total')
            .avg('trip_distance', 'avg_distance')
            .avg('passenger_count', 'avg_passengers')
            .count('trip_id', 'total_trips')
            .execute(),
          ctx.db.table('trips').select(['pickup_datetime']).limit(1000).execute(),
        ]);

        const total = toNumber(((countRows[0] ?? {}) as CountResult)?.total_count);
        const weeklyMap = new Map<string, number>();
        weeklyRows.forEach((row) => {
          const typedRow = row as WeeklyRowResult;
          const date = new Date(typedRow.pickup_datetime);
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          const key = weekStart.toISOString();
          weeklyMap.set(key, (weeklyMap.get(key) ?? 0) + 1);
        });

        const weeklyData = Array.from(weeklyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, 12)
          .map(([week, count]) => ({ week, count }));

        const statsRow = (statsRows[0] ?? {}) as DashboardStatsResult;

        return {
          trips: tripRows.map((row) => {
            const typedRow = row as DashboardTripResult;
            return {
              trip_id: String(typedRow.trip_id),
              pickup_datetime: String(typedRow.pickup_datetime),
              dropoff_datetime: String(typedRow.dropoff_datetime),
              trip_distance: toNumber(typedRow.trip_distance),
              passenger_count: toNumber(typedRow.passenger_count),
              fare_amount: toNumber(typedRow.fare_amount),
              tip_amount: toNumber(typedRow.tip_amount),
              total_amount: toNumber(typedRow.total_amount),
              payment_type: String(typedRow.payment_type),
            };
          }),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            hasNext: page * limit < total,
            hasPrev: page > 1,
          },
          stats: {
            avgTotalAmount: toNumber(statsRow.avg_total),
            avgDistance: toNumber(statsRow.avg_distance),
            avgPassengers: toNumber(statsRow.avg_passengers),
            totalTrips: toNumber(statsRow.total_trips),
          },
          weeklyData,
        } satisfies NodeDashboard;
      }),
  },
});

export type ApiDefinition = InferApiType<typeof apiDefinition>;
export const api = apiDefinition;
export default apiDefinition;

// Register routes for each query
api
  .route('/averageAmounts', api.queries.averageAmounts, { method: 'POST' })
  .route('/tripStats', api.queries.tripStats, { method: 'POST' })
  .route('/weeklyTripCounts', api.queries.weeklyTripCounts, { method: 'POST' })
  .route('/trips', api.queries.trips, { method: 'POST' })
  .route('/cachedSummary', api.queries.cachedSummary, { method: 'POST' })
  .route('/invalidateCache', api.queries.invalidateCache, { method: 'POST' })
  .route('/nodeDashboard', api.queries.nodeDashboard, { method: 'POST' });
