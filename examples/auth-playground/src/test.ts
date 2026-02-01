/**
 * Auth Guards Test Script
 *
 * Run this after starting the server to test all auth scenarios.
 * Run with: npm test
 */

interface TestCase {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body?: any;
  expectedStatus: number;
  expectedSuccess: boolean;
}

const BASE_URL = 'http://localhost:4321';

// Test cases covering all auth scenarios
const testCases: TestCase[] = [
  // ============================================================
  // PUBLIC ENDPOINT TESTS
  // ============================================================
  {
    name: '✅ Public endpoint without auth',
    method: 'GET',
    path: '/healthcheck',
    headers: {},
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // AUTHENTICATED ENDPOINT TESTS
  // ============================================================
  {
    name: '❌ Authenticated endpoint without credentials',
    method: 'GET',
    path: '/profile',
    headers: {},
    expectedStatus: 401,
    expectedSuccess: false,
  },
  {
    name: '✅ Authenticated endpoint with valid key',
    method: 'GET',
    path: '/profile',
    headers: { 'x-api-key': 'user-1' },
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // ROLE-BASED TESTS (OR semantics - admin OR editor)
  // ============================================================
  {
    name: '❌ Metrics endpoint without auth',
    method: 'GET',
    path: '/metrics',
    headers: {},
    expectedStatus: 401,
    expectedSuccess: false,
  },
  {
    name: '❌ Metrics endpoint with viewer role (wrong role)',
    method: 'GET',
    path: '/metrics',
    headers: { 'x-api-key': 'user-3' }, // Charlie (viewer)
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '✅ Metrics endpoint with editor role',
    method: 'GET',
    path: '/metrics',
    headers: { 'x-api-key': 'user-2' }, // Bob (editor)
    expectedStatus: 200,
    expectedSuccess: true,
  },
  {
    name: '✅ Metrics endpoint with admin role',
    method: 'GET',
    path: '/metrics',
    headers: { 'x-api-key': 'user-1' }, // Alice (admin)
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // SCOPE-BASED TESTS (AND semantics - need BOTH scopes)
  // ============================================================
  {
    name: '❌ Create metric without read:metrics scope',
    method: 'POST',
    path: '/metrics/create',
    headers: { 'x-api-key': 'user-3' }, // Charlie (viewer - only read:metrics)
    body: { name: 'Test', value: 100 },
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '✅ Create metric with read:metrics AND write:metrics',
    method: 'POST',
    path: '/metrics/create',
    headers: { 'x-api-key': 'user-2' }, // Bob (editor - has both scopes)
    body: { name: 'Test', value: 100 },
    expectedStatus: 200,
    expectedSuccess: true,
  },
  {
    name: '✅ Create metric with admin (all scopes)',
    method: 'POST',
    path: '/metrics/create',
    headers: { 'x-api-key': 'user-1' }, // Alice (admin - has all scopes)
    body: { name: 'Test', value: 100 },
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // ADMIN-ONLY TESTS
  // ============================================================
  {
    name: '❌ Secrets endpoint without auth',
    method: 'GET',
    path: '/secrets',
    headers: {},
    expectedStatus: 401,
    expectedSuccess: false,
  },
  {
    name: '❌ Secrets endpoint with viewer role',
    method: 'GET',
    path: '/secrets',
    headers: { 'x-api-key': 'user-3' }, // Charlie (viewer)
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '❌ Secrets endpoint with editor role',
    method: 'GET',
    path: '/secrets',
    headers: { 'x-api-key': 'user-2' }, // Bob (editor)
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '✅ Secrets endpoint with admin role',
    method: 'GET',
    path: '/secrets',
    headers: { 'x-api-key': 'user-1' }, // Alice (admin)
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // COMBINED GUARDS TESTS (role + scope)
  // ============================================================
  {
    name: '❌ Delete metric with admin role but no delete scope',
    method: 'POST',
    path: '/metrics/delete',
    headers: { 'x-api-key': 'user-2' }, // Bob (editor - has delete:metrics scope but not admin role)
    body: { id: 1 },
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '✅ Delete metric with admin role + delete scope',
    method: 'POST',
    path: '/metrics/delete',
    headers: { 'x-api-key': 'user-1' }, // Alice (admin - has both)
    body: { id: 1 },
    expectedStatus: 200,
    expectedSuccess: true,
  },

  // ============================================================
  // VIEWER DASHBOARD TESTS (specific role + scope combo)
  // ============================================================
  {
    name: '❌ Viewer dashboard without read:metrics scope',
    method: 'GET',
    path: '/dashboard/viewer',
    headers: { 'x-api-key': 'user-2' }, // Bob (editor - has scope but wrong role)
    expectedStatus: 403,
    expectedSuccess: false,
  },
  {
    name: '✅ Viewer dashboard with viewer role + read:metrics scope',
    method: 'GET',
    path: '/dashboard/viewer',
    headers: { 'x-api-key': 'user-3' }, // Charlie (viewer - has both)
    expectedStatus: 200,
    expectedSuccess: true,
  },
];

// ============================================================
// TEST RUNNER
// ============================================================

async function runTest(testCase: TestCase): Promise<void> {
  const url = `${BASE_URL}${testCase.path}`;
  const options: RequestInit = {
    method: testCase.method,
    headers: {
      'Content-Type': 'application/json',
      ...testCase.headers,
    },
  };

  if (testCase.body) {
    options.body = JSON.stringify(testCase.body);
  }

  try {
    const response = await fetch(url, options);
    const status = response.status;
    const body = await response.json();

    const statusMatch = status === testCase.expectedStatus;
    const successMatch = statusMatch; // For this test suite, success = status match

    const icon = statusMatch ? '✅' : '❌';
    const label = statusMatch ? 'PASS' : 'FAIL';

    console.log(`${icon} ${testCase.name}`);
    console.log(`   Status: ${status} (expected ${testCase.expectedStatus}) - ${label}`);

    if (!statusMatch) {
      console.log(`   Response:`, JSON.stringify(body, null, 2).split('\n').join('\n   '));
    } else if (testCase.expectedSuccess && body.error) {
      console.log(`   ⚠️  Got error response:`, body.error.message || body.error.type);
    } else if (testCase.expectedSuccess && body.data) {
      console.log(`   Response:`, JSON.stringify(body.data).slice(0, 100));
    }

    console.log('');
  } catch (error) {
    console.log(`❌ ${testCase.name}`);
    console.log(`   Error: ${error}\n`);
  }
}

async function main() {
  console.log('\n🧪 Auth Guards Test Suite');
  console.log('=========================\n');

  // Check if server is running
  try {
    await fetch(BASE_URL);
  } catch {
    console.error('❌ Server not running at', BASE_URL);
    console.error('Please start the server first: npm run dev\n');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    await runTest(testCase);

    // Count results (simplified - based on expected status)
    try {
      const url = `${BASE_URL}${testCase.path}`;
      const response = await fetch(url, {
        method: testCase.method,
        headers: testCase.headers as any,
        body: testCase.body ? JSON.stringify(testCase.body) : undefined,
      });

      if (response.status === testCase.expectedStatus) {
        passed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  console.log('=========================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Total: ${testCases.length} tests\n`);
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
