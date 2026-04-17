import { initServe } from '@hypequery/serve';
import type { InferApiType } from '@hypequery/serve';
import { z } from 'zod';

const { query, serve } = initServe({
  context: () => ({}),
  basePath: '/',
});

const postTest = query({
  description: 'Simple hello world query',
  input: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  query: async () => ({
    message: 'Hello from hypequery!',
    timestamp: new Date().toISOString(),
  }),
});

const hello = query({
  description: 'Simple hello world query',
  input: z.void(),
  output: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  query: async () => ({
    message: 'Hello from hypequery!',
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

const apiDefinition = serve({
  queries: {
    postTest,
    hello,
    stats,
  },
});

export type ApiDefinition = InferApiType<typeof apiDefinition>;
export const api = apiDefinition;
export default apiDefinition;

// Register routes for GET requests
api
  .route('/hello', api.queries.hello)
  .route('/stats', api.queries.stats)
  .route('/postTest', api.queries.postTest, { method: 'POST' });
