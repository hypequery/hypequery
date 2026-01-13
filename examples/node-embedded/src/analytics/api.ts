import { defineServe } from '@hypequery/serve';
import { selectExpr } from '@hypequery/clickhouse';
import { z } from 'zod';

import { db } from './client.js';

export const api = defineServe({
  context: () => ({ db }),
  queries: {
    weeklyRevenue: {
      inputSchema: z.object({ start: z.string(), end: z.string() }),
      outputSchema: z.array(z.object({ week: z.string(), total: z.number() })),
      query: async ({ ctx, input }) => {
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
      },
    },
    passengerStats: {
      outputSchema: z.object({ avgPassengers: z.number(), totalTrips: z.number() }),
      query: async ({ ctx }) => {
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
      },
    },
  },
});
