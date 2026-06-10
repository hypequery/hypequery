/* ════════════════════════════════════════════════════════════
   Code Snippets and Constants for Homepage
   ════════════════════════════════════════════════════════════ */

export const HERO_SNIPPETS = {
  query: `import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder({
  host: process.env.CLICKHOUSE_HOST,
});

const latestOrders = await db
  .table('orders')
  .select(['id', 'amount', 'created_at'])
  .where('status', 'eq', 'paid')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();
//  ↑ Full autocomplete from your schema`,

  dataset: `import { dataset, dimension, measure } from '@hypequery/datasets';

// NEW — model a table once, reuse everywhere
export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    plan: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
await executor.metric(revenue.by('month'), {
  dimensions: ['plan'],
});`,

  serve: `import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const revenueByPlan = query({
  description: 'Monthly revenue by plan',
  input: z.object({ tenantId: z.string() }),
  query: ({ input }) =>
    executor.metric(revenue.by('month'), {
      dimensions: ['plan'],
    }, { runtime: { tenant: { id: input.tenantId } } }),
});

serve({ queries: { revenueByPlan } });
//  ↑ Typed HTTP route + React hook from the same definition`,
};

export const HERO_TABS = [
  { id: 'query', label: 'query-builder.ts' },
  { id: 'dataset', label: 'datasets.ts' },
  { id: 'serve', label: 'serve-runtime.ts' },
];

export const OLD_WAY_CODE = `const result = await client.query({
  query: \`
    SELECT name, email, created_at
    FROM users
    WHERE created_at >= '2024-01-01'
    AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 10
  \`
});

// No type safety
// Typos caught at runtime
// SQL gets duplicated
// Hard to refactor safely`;

export const HYPEQUERY_WAY_CODE = `const result = await db
  .table('users')
  .select(['name', 'email', 'created_at'])
  .where('created_at', 'gte', '2024-01-01')
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();

// Full type safety
// Compile-time checks
// Shared query logic
// Refactor with confidence`;

export const QUERY_CODE = `const latestOrders = await db
  .table('orders')
  .select(['id', 'amount', 'created_at'])
  .where('status', 'eq', 'paid')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();

// Full type safety
// Compile-time checks
// Shared query logic
// Refactor with confidence`;

export const DATASET_CODE = `export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: {
    plan: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});


`;

export const DATASETS_SECTION_CODE = `import {
  dataset,
  dimension,
  divide,
  measure,
  nullIfZero,
} from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    plan: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});

const result = await executor.metric(averageOrderValue.by('month'), {
  dimensions: ['plan'],
}, { runtime: { tenant: { id: tenantId } } });

const sql = executor.toSQL(averageOrderValue.by('month'), {
  dimensions: ['plan'],
});`;

export const SERVE_CODE = `
export const api = serve({
  queries: { revenueByPlan },
  datasets: { orders: Orders },
});
// typed HTTP route + React hook
// From one definition`;

/* ── Variant A — "All in on Datasets" ─────────────────────── */

// "Define it once" — the one dataset definition everything inherits from
export const DEFINE_ONCE_CODE = `export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    plan: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});`;

// D — Datasets: name reusable metrics, compose derived ones
export const FEATURE_D_CODE = `const revenue = Orders.metric('revenue', { measure: 'revenue' });
const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});

// Run it from server code, jobs, APIs, hooks, or agents
await executor.metric(averageOrderValue.by('month'), {
  dimensions: ['plan'],
});`;

// S — Serve: one definition becomes a typed API
export const FEATURE_S_CODE = `export const api = serve({
  datasets: { orders: Orders },
  queries: { revenueByPlan },
});
// → typed REST route + OpenAPI spec + React hook`;

// M — MCP: expose the registry as governed agent tools
export const FEATURE_M_CODE = `await createMCPServer({
  datasets: { orders: Orders },
  executor,
});
// agents query exposed datasets only — never raw SQL`;

export const MCP_CODE = `import { createMCPServer } from '@hypequery/mcp';
import { createExecutor } from '@hypequery/datasets';

const executor = createExecutor({ queryBuilder: db });

await createMCPServer({
  datasets: { orders: Orders },
  executor,
});
// agents can query exposed datasets only`;

export const MCP_SECTION_CODE = `import { createMCPServer } from '@hypequery/mcp';
import { createExecutor } from '@hypequery/datasets';
import { Orders } from './datasets/orders';
import { db } from './db';

const executor = createExecutor({ queryBuilder: db });

await createMCPServer({
  datasets: { orders: Orders },
  executor,
  name: 'analytics-mcp',
});
// MCP exposes list_datasets, get_dataset_schema,
// query_dataset, and query_metric for this registry`;

export const BEFORE_QUERIES = `// Raw SQL strings everywhere
const result = await client.query({
  query: \`
    SELECT id, email, created_at
    FROM users
    WHERE status = 'active'
    AND tenant_id = '\${tenantId}'  -- Hope you remember this
  \`
});
// No types. Runtime failures. Scattered logic.`;

export const BEFORE_METRICS = `# cube.yml
cubes:
  - name: Users
    sql: SELECT * FROM users
    measures:
      - name: count
        type: count
    dimensions:
      - name: email
        sql: email
        type: string`;

export const BEFORE_API = `// Express controller boilerplate
app.post('/api/users', async (req, res) => {
  const result = await runQuery(req.body);
  res.json(result);
});`;

export const AFTER_CODE = `// datasets/users.ts - Define the table once
export const Users = dataset('users', {
  source: 'users',
  tenantKey: 'tenant_id',  // Enforced everywhere automatically
  timeKey: 'created_at',
  dimensions: {
    id:        dimension.string(),
    email:     dimension.string(),
    status:    dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  }
});

// queries/active-users.ts - Type-safe dataset query
const activeUsers = await executor.dataset(Users, {
  dimensions: ['id', 'email'],
  filters: [eq('status', 'active')],
  limit: 10,
});

// serve/api.ts - Instant typed API
const activeUsersRoute = query({
  query: ({ ctx }) =>
    ctx.db.table('users')
      .where('status', 'eq', 'active')
      .limit(10)
      .execute(),
});

serve({
  queries: { activeUsersRoute },
  datasets: { users: Users },
  queryBuilder: db,
});
// Typed route + React hook from the same definition`;

export const DATASET_DEFINITION = `import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id:        dimension.string(),
    amount:    dimension.number(),
    status:    dimension.string(),
    userId:    dimension.string({ column: 'user_id' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});`;

export const DATASET_API_USE = `// In your API route
const revenue = await executor.dataset(Orders, {
  measures: ['revenue'],
  filters: [eq('status', 'paid')],
}, { runtime: { tenant: { id: tenantId } } });
// Auto-filtered by tenant_id`;

export const DATASET_JOB_USE = `// In your background job
const dailyRevenue = await executor.dataset(Orders, {
  measures: ['revenue'],
  filters: [gte('createdAt', startOfDay)],
}, { runtime: { tenant: { id: tenantId } } });
// Same tenant filter, same definition`;

export const DATASET_DASHBOARD_USE = `// In your React dashboard
const { data } = useQuery('dataset:orders', {
  dimensions: ['userId'],
  measures: ['revenue'],
  filters: [eq('status', 'paid')],
});
// Same filter, same types, zero duplication`;

export const IN_PROCESS_CODE = `// Anywhere in your backend
const revenue = Orders.metric('revenue', { measure: 'revenue' });

export async function revenueByPlan(tenantId: string) {
  return executor.metric(revenue.by('month'), {
    dimensions: ['plan'],
  }, { runtime: { tenant: { id: tenantId } } });
}`;

export const MARQUEE_ITEMS = [
  { mark: 'ACME', text: 'Replaced 40+ raw SQL endpoints with typed queries' },
  { mark: 'NORTHWIND', text: '12 datasets · zero duplicated metrics' },
  { mark: 'BLAKE', text: 'Same queries powering API, jobs, and React' },
  { mark: 'CONTOSO', text: 'Multi-tenant analytics for 300+ accounts' },
  { mark: 'MERIDIAN', text: 'Datasets shared between web app and notebooks' },
  { mark: 'OBELIX', text: 'Type-safe queries — refactor without fear' },
];

export const CLOUD_ROUTES = [
  { method: 'POST', route: '/api/active-users', stat: '12,481 req · 18ms' },
  { method: 'POST', route: '/api/revenue-by-plan', stat: '3,204 req · 42ms' },
  { method: 'GET', route: '/api/churn-cohort', stat: 'p99 · 1.2s ⚠', alert: true },
  { method: 'POST', route: '/api/funnel', stat: '812 req · 88ms' },
];

export const TENANCY_OLD_WAY = `const rows = await client.query({
  query: \`
    SELECT id, email FROM orders
    WHERE tenant_id = '\${tenantId}'  -- hope every query remembers this
  \`,
});
// forget the filter in one of 40 queries → you leak a tenant's data
// interpolated string → injection risk
// no types → typos surface in production`;

export const TENANCY_HYPEQUERY_WAY = `const rows = await executor.dataset(Orders, {
  dimensions: ['id', 'email'],
}, { runtime: { tenant: { id: tenantId } } });
// tenant filter injected from the dataset, automatically
// omit tenant context where required → the request fails before query execution`;
