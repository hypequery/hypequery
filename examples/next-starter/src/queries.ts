import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { define, queries, query } = initServe({
  context: () => ({}),
});

export const api = define({
  queries: queries({
    postTest: query
      .describe('Simple hello world query')
      .input(z.object({
        message: z.string(),
        timestamp: z.string(),
      }))
      .query(async () => ({
        message: 'Hello from hypequery!',
        timestamp: new Date().toISOString(),
      })),
    hello: query
      .describe('Simple hello world query')
      .output(z.object({
        message: z.string(),
        timestamp: z.string(),
      }))
      .query(async () => ({
        message: 'Hello from hypequery!',
        timestamp: new Date().toISOString(),
      })),
    stats: query
      .describe('Get some example stats')
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

// Register routes for GET requests
api
  .route('/hello', api.queries.hello)
  .route('/stats', api.queries.stats)
  .route('/postTest', api.queries.postTest, { method: 'POST' });
