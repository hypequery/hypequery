/**
 * Auth Guards Playground - Test Server
 *
 * This example demonstrates all auth guard features with hard-coded data.
 * Run with: npm run dev
 * Then test with the provided test script or curl commands.
 */

import { initServe, createAuthSystem, serveDev } from '@hypequery/serve';
import { z } from 'zod';
import type { ServeRequest } from '@hypequery/serve';

// ============================================================
// MOCK DATABASE
// ============================================================

const mockDb = {
  users: [
    { id: 1, name: 'Alice', role: 'admin', scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] },
    { id: 2, name: 'Bob', role: 'editor', scopes: ['read:metrics', 'write:metrics'] },
    { id: 3, name: 'Charlie', role: 'viewer', scopes: ['read:metrics'] },
  ],
  metrics: [
    { id: 1, name: 'Revenue', value: 100000 },
    { id: 2, name: 'Users', value: 5432 },
    { id: 3, name: 'Orders', value: 891 },
  ],
  secrets: [
    { id: 1, key: 'API_KEY', value: 'sk_live_12345' },
    { id: 2, key: 'DB_PASSWORD', value: 'supersecret' },
  ],
};

// ============================================================
// TYPESAFE AUTH SYSTEM
// ============================================================

const { useAuth, TypedAuth } = createAuthSystem({
  roles: ['admin', 'editor', 'viewer'] as const,
  scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] as const,
});

type AppAuth = typeof TypedAuth;
type AppContext = { db: typeof mockDb };

// ============================================================
// AUTH STRATEGIES
// ============================================================

/**
 * Simple API key strategy - looks for x-api-key header
 * Key format: "user-{id}" (e.g., "user-1" for Alice/admin)
 */
const apiKeyStrategy = async ({ request }: { request: ServeRequest }): Promise<AppAuth | null> => {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey) {
    return null;
  }

  // Extract user ID from API key
  const match = apiKey.match(/^user-(\d+)$/);
  if (!match) {
    return null;
  }

  const userId = parseInt(match[1], 10);
  const user = mockDb.users.find((u) => u.id === userId);

  if (!user) {
    return null;
  }

  return {
    userId: String(user.id),
    userName: user.name,
    roles: [user.role as 'admin' | 'editor' | 'viewer'],
    scopes: user.scopes as ('read:metrics' | 'write:metrics' | 'delete:metrics')[],
  };
};

// ============================================================
// API DEFINITION
// ============================================================

const { define, query } = initServe<AppContext, AppAuth>({
  context: { db: mockDb },
});

const api = define({
  auth: useAuth(apiKeyStrategy),
  basePath: '/',

  queries: {
    // PUBLIC ENDPOINT - No auth required
    healthcheck: query
      .public()
      .query(async () => ({
        status: 'ok',
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
      })),

    // AUTHENTICATED ENDPOINT - Must be logged in
    profile: query
      .requireAuth()
      .query(async ({ ctx }) => {
        const user = mockDb.users.find((u) => u.id === Number(ctx.auth!.userId));
        return {
          user: {
            id: user?.id,
            name: user?.name,
            role: user?.role,
          },
          auth: {
            userId: ctx.auth?.userId,
            roles: ctx.auth?.roles,
            scopes: ctx.auth?.scopes,
          },
        };
      }),

    // ROLE-BASED - Must be admin OR editor (OR semantics)
    metrics: query
      .requireRole('admin', 'editor')
      .query(async ({ ctx }) => {
        return {
          metrics: mockDb.metrics,
          requestedBy: ctx.auth?.userName,
        };
      }),

    // SCOPE-BASED - Must have read:metrics AND write:metrics (AND semantics)
    createMetric: query
      .requireScope('read:metrics', 'write:metrics')
      .input(z.object({
        name: z.string(),
        value: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        return {
          message: 'Metric created',
          metric: {
            id: mockDb.metrics.length + 1,
            name: input.name,
            value: input.value,
          },
          createdBy: ctx.auth?.userName,
        };
      }),

    // ADMIN ONLY - Single role check
    secrets: query
      .requireRole('admin')
      .query(async ({ ctx }) => {
        return {
          secrets: mockDb.secrets,
          accessedBy: ctx.auth?.userName,
        };
      }),

    // DELETE PERMISSION - Requires admin role + delete scope
    deleteMetric: query
      .requireRole('admin')
      .requireScope('delete:metrics')
      .input(z.object({
        id: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        return {
          message: `Metric ${input.id} deleted`,
          deletedBy: ctx.auth?.userName,
        };
      }),

    // COMBINED GUARDS - Viewer role + read scope
    viewerDashboard: query
      .requireRole('viewer')
      .requireScope('read:metrics')
      .query(async ({ ctx }) => {
        return {
          summary: {
            totalMetrics: mockDb.metrics.length,
            totalUsers: mockDb.users.length,
          },
          viewedBy: ctx.auth?.userName,
        };
      }),
  },
});

// ============================================================
// REGISTER ROUTES
// ============================================================

api.route('/healthcheck', api.queries.healthcheck, { method: 'GET'});
api.route('/profile', api.queries.profile);
api.route('/metrics', api.queries.metrics);
api.route('/metrics/create', api.queries.createMetric);
api.route('/secrets', api.queries.secrets);
api.route('/metrics/delete', api.queries.deleteMetric);
api.route('/dashboard/viewer', api.queries.viewerDashboard);

// ============================================================
// START SERVER
// ============================================================

const PORT = 4321;

async function main() {
  const server = await serveDev(api, {
    port: PORT,
    quiet: true,
  });

  console.log('\n🚀 Auth Guards Playground Server');
  console.log('=====================================\n');
  console.log(`Server running at http://localhost:${PORT}\n`);
  console.log('Available endpoints:');
  console.log('  GET  /healthcheck        (public)');
  console.log('  GET  /profile            (authenticated)');
  console.log('  GET  /metrics            (admin OR editor)');
  console.log('  POST /metrics/create     (read:metrics AND write:metrics scopes)');
  console.log('  GET  /secrets            (admin role only)');
  console.log('  POST /metrics/delete     (admin role + delete:metrics scope)');
  console.log('  GET  /dashboard/viewer   (viewer role + read:metrics scope)\n');
  console.log('Test users:');
  console.log('  Alice (admin):   x-api-key: user-1');
  console.log('  Bob (editor):    x-api-key: user-2');
  console.log('  Charlie (viewer): x-api-key: user-3\n');
  console.log('Run tests with: npm test\n');

  return server;
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
