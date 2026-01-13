import { defineServe } from '@hypequery/serve';
import { z } from 'zod';

const mockOrders = [
  { week: '2024-01-01', plan: 'starter', total: 4200, region: 'us' },
  { week: '2024-01-08', plan: 'starter', total: 4800, region: 'eu' },
  { week: '2024-01-15', plan: 'pro', total: 9600, region: 'us' },
  { week: '2024-01-22', plan: 'enterprise', total: 14000, region: 'apac' },
];

const growthNotes = [
  { week: '2024-01-01', summary: 'Seasonal promo increased upgrades.' },
  { week: '2024-01-22', summary: 'Launched APAC partnerships.' },
];

export const api = defineServe({
  queries: {
    weeklyRevenue: {
      description: 'Return weekly revenue totals grouped by plan.',
      inputSchema: z.object({ plan: z.string().optional() }).default({}),
      outputSchema: z.array(z.object({ week: z.string(), plan: z.string(), total: z.number() })),
      query: async ({ input }) =>
        mockOrders.filter((row) => (input.plan ? row.plan === input.plan : true)),
    },
    regionalBreakdown: {
      description: 'Aggregate by geographic region.',
      outputSchema: z.array(z.object({ region: z.string(), total: z.number() })),
      query: async () => {
        const results: Record<string, number> = {};
        for (const row of mockOrders) {
          results[row.region] = (results[row.region] ?? 0) + row.total;
        }
        return Object.entries(results).map(([region, total]) => ({ region, total }));
      },
    },
    growthNotes: {
      description: 'Annotated insights that explain spikes/dips.',
      outputSchema: z.array(z.object({ week: z.string(), summary: z.string() })),
      query: async () => growthNotes,
    },
  },
});
