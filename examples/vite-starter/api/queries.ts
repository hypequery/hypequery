import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { query, serve } = initServe({
  context: () => ({}),
  basePath: '/api'
});

const hello = query({
  description: 'Simple hello world query',
  input: z.void(),
  output: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  query: async () => ({
    message: 'Hello from hypequery + Vite!',
    timestamp: new Date().toISOString(),
  }),
});

const stats = query({
  description: 'Get some example stats',
  input: z.void(),
  output: z.object({
    users: z.number(),
    revenue: z.number(),
    growth: z.number(),
  }),
  query: async () => ({
    users: 1337,
    revenue: 98765,
    growth: 23.5,
  }),
});

export const api = serve({
  queries: {
    hello,
    stats,
  },
});

// Register routes
api
  .route('/hello', api.queries.hello, { method: 'GET' })
  .route('/stats', api.queries.stats, { method: 'GET' });
