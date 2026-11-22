import type { ComparisonCode } from '@/data/comparisons/types';

// The hypequery side of every hypequery-vs-<vendor> page: one dataset with a
// tenant key and result limits, served as an authenticated API. Type-checked
// against @hypequery/datasets and @hypequery/serve from npm on 2026-11-22
// (see seo-verification-log.md). `db` and `verifySession` are your query
// builder and your existing session check.
export const tenantScopedDatasetCode: ComparisonCode = {
  filename: 'analytics/orders.ts',
  code: `import { dataset, dimension, measure } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';
import { db } from './client'; // createQueryBuilder({ url, username, password, database })
import { verifySession } from './auth'; // your JWT or session check

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'org_id', // added to every query from the session; queries without it fail
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('order_id'),
    revenue: measure.sum('amount'),
  },
  limits: { maxResultSize: 1_000 },
});

const { serve } = initServe({
  auth: async ({ request }) => verifySession(request.headers.authorization),
  tenant: { extract: (auth) => auth?.orgId, required: true },
});

// POST /datasets/orders/query, with request validation and an OpenAPI spec
export const api = serve({ queryBuilder: db, datasets: { orders: Orders } });`,
  caption:
    'The tenant comes from your auth, never from the request body, and a caller cannot add their own `org_id` filter. `hypequery mcp` serves the same datasets to agents as tools ([MCP quickstart](/docs/mcp/quickstart)).',
};
