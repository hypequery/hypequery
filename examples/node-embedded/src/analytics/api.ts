import { initServe } from '@hypequery/serve';
import { selectExpr } from '@hypequery/clickhouse';
import { z } from 'zod';

import { db } from './client.js';

const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    weeklyRevenue: query
      .describe('Weekly revenue grouped by pickup week')
      .input(z.object({ start: z.string(), end: z.string() }))
      .output(z.array(z.object({ week: z.string(), total: z.number() })))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .table('trips')
          .where('pickup_datetime', 'gte', input.start)
          .where('pickup_datetime', 'lte', input.end)
          .select([selectExpr('toStartOfWeek(pickup_datetime)', 'week')])
          .sum('total_amount', 'total')
          .groupBy(['week'])
          .orderBy('week', 'ASC')
          .execute();

        return rows.map((row) => ({
          week: (row as any).week,
          total: Number((row as any).total ?? 0),
        }));
      }),
    passengerStats: query
      .describe('Passenger averages for recent trips')
      .output(z.object({ avgPassengers: z.number(), totalTrips: z.number() }))
      .query(async ({ ctx }) => {
        const rows = await ctx.db
          .table('trips')
          .avg('passenger_count', 'avg_passengers')
          .count('trip_id', 'total_trips')
          .execute();
        const row = rows[0] ?? {};
        return {
          avgPassengers: Number((row as any).avg_passengers ?? 0),
          totalTrips: Number((row as any).total_trips ?? 0),
        };
      }),
  }),
});
