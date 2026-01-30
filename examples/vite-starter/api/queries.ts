import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { define, queries, query } = initServe({
  context: () => ({}),
});

export const api = define({
  queries: queries({
    hello: query
      .describe('Simple hello world query')
      .input(z.void())
      .output(z.object({
        message: z.string(),
        timestamp: z.string(),
      }))
      .query(async () => ({
        message: 'Hello from hypequery + Vite!',
        timestamp: new Date().toISOString(),
      })),

    stats: query
      .describe('Get some example stats')
      .input(z.void())
      .output(z.object({
        users: z.number(),
        revenue: z.number(),
        growth: z.number(),
      }))
      .query(async () => ({
        users: 1337,
        revenue: 98765,
        growth: 23.5,
      })),
  }),
});

// Register routes
api
  .route('/hello', api.queries.hello, { method: 'GET' })
  .route('/stats', api.queries.stats, { method: 'GET' });
