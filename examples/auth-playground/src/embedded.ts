/**
 * Auth Guards with Embedded/In-Process Execution
 *
 * This example shows that auth guards work exactly the same
 * when calling api.run() directly (no HTTP layer).
 */

import { initServe, createAuthSystem } from '@hypequery/serve';

// ============================================================
// TYPESAFE AUTH SYSTEM
// ============================================================

const { useAuth, TypedAuth } = createAuthSystem({
  roles: ['admin', 'editor', 'viewer'] as const,
  scopes: ['read:data', 'write:data'] as const,
});

type AppAuth = typeof TypedAuth;
type AppContext = { db: { data: string } };

// ============================================================
// AUTH STRATEGY
// ============================================================

// Simple strategy that reads from a synthetic request
const authStrategy = async ({ request }: { request: any }): Promise<AppAuth | null> => {
  const token = request.headers?.['x-auth-token'];
  if (!token) return null;

  // Mock user lookup
  const users: Record<string, AppAuth> = {
    'admin-token': {
      userId: 'admin-1',
      userName: 'Admin',
      roles: ['admin'],
      scopes: ['read:data', 'write:data'],
    },
    'viewer-token': {
      userId: 'viewer-1',
      userName: 'Viewer',
      roles: ['viewer'],
      scopes: ['read:data'],
    },
  };

  return users[token] || null;
};

// ============================================================
// API DEFINITION
// ============================================================

const { define, query } = initServe<AppContext, AppAuth>({
  context: { db: { data: 'mock-data' } },
});

const api = define({
  auth: useAuth(authStrategy),

  queries: {
    // Public endpoint
    public: query
      .public()
      .query(async () => ({
        message: 'Anyone can access this',
      })),

    // Authenticated
    profile: query
      .requireAuth()
      .query(async ({ ctx }) => ({
        userId: ctx.auth?.userId,
        roles: ctx.auth?.roles,
      })),

    // Role-based
    adminOnly: query
      .requireRole('admin')
      .query(async ({ ctx }) => ({
        message: 'Admin data',
        userId: ctx.auth?.userId,
      })),

    // Scope-based
    writeData: query
      .requireScope('write:data')
      .query(async ({ ctx }) => ({
        message: 'Data written',
        userId: ctx.auth?.userId,
      })),

    // Combined guards
    superAdmin: query
      .requireRole('admin')
      .requireScope('write:data')
      .query(async ({ ctx }) => ({
        message: 'Super admin operation',
        userId: ctx.auth?.userId,
      })),
  },
});

// Register routes
api.route('/public', api.queries.public);
api.route('/profile', api.queries.profile);
api.route('/admin', api.queries.adminOnly);
api.route('/write', api.queries.writeData);
api.route('/super', api.queries.superAdmin);

// ============================================================
// EMBEDDED EXECUTION EXAMPLES
// ============================================================

async function main() {
  console.log('\n🔐 Auth Guards with Embedded Execution');
  console.log('======================================\n');

  // ============================================================
  // 1. PUBLIC ENDPOINT - No auth required
  // ============================================================
  console.log('1️⃣  Public endpoint (no auth)');
  try {
    const result = await api.run('public');
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  // ============================================================
  // 2. AUTHENTICATED ENDPOINT - No auth provided
  // ============================================================
  console.log('2️⃣  Authenticated endpoint (no auth)');
  try {
    const result = await api.run('profile');
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.type, '-', error.message);
  }
  console.log('');

  // ============================================================
  // 3. AUTHENTICATED ENDPOINT - With valid auth
  // ============================================================
  console.log('3️⃣  Authenticated endpoint (with valid token)');
  try {
    const result = await api.run('profile', {
      request: {
        method: 'POST',
        path: '/profile',
        headers: { 'x-auth-token': 'admin-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  // ============================================================
  // 4. ROLE-BASED - Wrong role
  // ============================================================
  console.log('4️⃣  Admin endpoint (viewer token)');
  try {
    const result = await api.run('adminOnly', {
      request: {
        method: 'POST',
        path: '/admin',
        headers: { 'x-auth-token': 'viewer-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.type, '-', error.message);
  }
  console.log('');

  // ============================================================
  // 5. ROLE-BASED - Correct role
  // ============================================================
  console.log('5️⃣  Admin endpoint (admin token)');
  try {
    const result = await api.run('adminOnly', {
      request: {
        method: 'POST',
        path: '/admin',
        headers: { 'x-auth-token': 'admin-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  // ============================================================
  // 6. SCOPE-BASED - Missing required scope
  // ============================================================
  console.log('6️⃣  Write endpoint (viewer - no write scope)');
  try {
    const result = await api.run('writeData', {
      request: {
        method: 'POST',
        path: '/write',
        headers: { 'x-auth-token': 'viewer-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.type, '-', error.message);
  }
  console.log('');

  // ============================================================
  // 7. COMBINED GUARDS - Has both role and scope
  // ============================================================
  console.log('7️⃣  Super admin endpoint (admin token + write scope)');
  try {
    const result = await api.run('superAdmin', {
      request: {
        method: 'POST',
        path: '/super',
        headers: { 'x-auth-token': 'admin-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  // ============================================================
  // 8. SKIP AUTH WITH CUSTOM CONTEXT
  // ============================================================
  console.log('8️⃣  Bypass auth by providing custom context');
  try {
    // You can skip auth entirely by providing context directly
    const result = await api.run('adminOnly', {
      context: {
        db: { data: 'mock-data' },
      },
      request: {
        method: 'POST',
        path: '/admin',
        headers: { 'x-auth-token': 'admin-token' },
        query: {},
      },
    });
    console.log('✅ Success:', result);
  } catch (error: any) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  console.log('======================================');
  console.log('✅ All auth guards work with embedded execution!\n');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
