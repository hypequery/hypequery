/**
 * Dev server example with mock queries (no ClickHouse needed).
 *
 * Run with: pnpm dev:server
 *
 *   Dev Tools:  http://localhost:4000/__dev
 *   API Docs:   http://localhost:4000/docs
 *   Playground:  http://localhost:4000/__dev  (Playground tab)
 */
import { defineServe, serveDev } from '@hypequery/serve';
import { z } from 'zod';

const api = defineServe({
  queries: {
    listUsers: {
      description: 'List users with optional pagination',
      input: z.object({
        limit: z.number().min(1).max(100).default(10),
        offset: z.number().min(0).default(0),
      }),
      output: z.array(z.object({
        id: z.number(),
        name: z.string(),
        email: z.string(),
        createdAt: z.string(),
      })),
      query: async ({ input }: { input: { limit: number; offset: number } }) => {
        return Array.from({ length: input.limit }, (_, i) => ({
          id: input.offset + i + 1,
          name: `User ${input.offset + i + 1}`,
          email: `user${input.offset + i + 1}@example.com`,
          createdAt: new Date(Date.now() - i * 86400000).toISOString(),
        }));
      },
    },

    getUser: {
      description: 'Get a single user by ID',
      input: z.object({ id: z.number() }),
      output: z.object({
        id: z.number(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
        createdAt: z.string(),
      }),
      query: async ({ input }: { input: { id: number } }) => ({
        id: input.id,
        name: `User ${input.id}`,
        email: `user${input.id}@example.com`,
        role: input.id === 1 ? 'admin' : 'user',
        createdAt: new Date().toISOString(),
      }),
    },

    getStats: {
      description: 'Get summary statistics',
      output: z.object({
        totalUsers: z.number(),
        activeToday: z.number(),
        revenue: z.number(),
      }),
      query: async () => ({
        totalUsers: 1234,
        activeToday: 567,
        revenue: 89012.50,
      }),
    },

    search: {
      description: 'Search across all entities',
      input: z.object({
        q: z.string().min(1),
        type: z.enum(['users', 'orders', 'products']).default('users'),
        limit: z.number().max(50).default(20),
      }),
      output: z.array(z.object({
        id: z.number(),
        type: z.string(),
        title: z.string(),
        score: z.number(),
      })),
      query: async ({ input }: { input: { q: string; type: string; limit: number } }) => {
        return Array.from({ length: Math.min(input.limit, 5) }, (_, i) => ({
          id: i + 1,
          type: input.type,
          title: `${input.type} matching "${input.q}" #${i + 1}`,
          score: Math.round((1 - i * 0.15) * 100) / 100,
        }));
      },
    },
  },
});

// Register HTTP routes
api.route('/users', api.queries.listUsers);
api.route('/users/:id', api.queries.getUser);
api.route('/stats', api.queries.getStats);
api.route('/search', api.queries.search);

async function main() {
  const server = await serveDev(api, {
    port: 4000,
    hostname: 'localhost',
  });

  console.log('\nTest API routes:');
  console.log('  GET  http://localhost:4000/users?limit=5');
  console.log('  GET  http://localhost:4000/users/1');
  console.log('  GET  http://localhost:4000/stats');
  console.log('  GET  http://localhost:4000/search?q=test&type=users');
  console.log('\nPress Ctrl+C to stop.\n');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start dev server:', error);
  process.exit(1);
});
