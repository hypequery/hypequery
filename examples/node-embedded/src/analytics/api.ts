import { initServe } from '@hypequery/serve';
import { selectExpr } from '@hypequery/clickhouse';
import { z } from 'zod';

import { db } from './client.js';

const demoDictionary = process.env.CLICKHOUSE_DEMO_DICTIONARY;
const demoDictionaryAttribute =
  process.env.CLICKHOUSE_DEMO_DICTIONARY_ATTRIBUTE ?? 'label';

const { query, serve } = initServe({
  context: () => ({ db }),
});

const weeklyRevenue = query({
  description: 'Weekly revenue grouped by pickup week',
  input: z.object({ start: z.string(), end: z.string() }),
  output: z.array(z.object({ week: z.string(), total: z.number() })),
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
});

const passengerStats = query({
  description: 'Passenger averages for recent trips',
  output: z.object({ avgPassengers: z.number(), totalTrips: z.number() }),
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
});

const passengerLabels = query({
  description: 'Resolve passenger_count labels with ClickHouse dictGet (requires a configured dictionary)',
  input: z.object({
    limit: z.number().int().positive().max(20).default(10),
    dictionary: z.string().optional(),
    attribute: z.string().optional(),
  }),
  output: z.array(
    z.object({
      passengerCount: z.number(),
      passengerLabel: z.string(),
      tripCount: z.number(),
    })
  ),
  query: async ({ ctx, input }) => {
    const dictionary = input.dictionary ?? demoDictionary;
    const attribute = input.attribute ?? demoDictionaryAttribute;
    const limit = input.limit ?? 10;

    if (!dictionary) {
      throw new Error(
        'Set CLICKHOUSE_DEMO_DICTIONARY or pass input.dictionary to run passengerLabels.'
      );
    }

    const rows = await ctx.db
      .table('trips')
      .withScalar('passenger_label', (expr) =>
        expr.ch.dictGet(dictionary, attribute, expr.col('passenger_count'))
      )
      .select(['passenger_count', 'passenger_label'])
      .count('trip_id', 'trip_count')
      .groupBy(['passenger_count', 'passenger_label'])
      .orderBy('trip_count', 'DESC')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      passengerCount: Number((row as any).passenger_count ?? 0),
      passengerLabel: String((row as any).passenger_label ?? ''),
      tripCount: Number((row as any).trip_count ?? 0),
    }));
  },
});

export const api = serve({
  queries: {
    weeklyRevenue,
    passengerStats,
    passengerLabels,
  },
});
