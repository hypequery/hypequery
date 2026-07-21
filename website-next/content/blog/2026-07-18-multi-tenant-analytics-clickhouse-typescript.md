---
title: "How to Build Multi-Tenant Analytics with ClickHouse and TypeScript"
description: "How to enforce tenant isolation in application code for ClickHouse analytics: tenant-scoped serve contexts, tenantKey on datasets, builder-level filters, and why you should still keep row policies as a backstop."
seoTitle: "Multi-Tenant Analytics with ClickHouse and TypeScript"
seoDescription: "Build multi-tenant analytics on ClickHouse with TypeScript. Enforce tenant isolation in application code with tenant-scoped contexts, dataset tenant keys, and defense-in-depth row policies."
pubDate: 2026-07-18
heroImage: ""
slug: multi-tenant-analytics-clickhouse-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

**Short answer:** put `tenant_id` first in your sort key, resolve the tenant once at the API boundary from auth, and make the query layer apply the tenant filter automatically so no individual query function is responsible for remembering it. In hypequery that means three concrete mechanisms: a serve context that injects `tenantId` per request, `tenantKey` on datasets so every semantic query gets tenant scoping applied at plan time, and explicit `.where('tenant_id', 'eq', ...)` filters for the hand-written builder queries that remain. Keep ClickHouse row policies underneath as a backstop, not as your primary mechanism.

This post is about the middle layer: enforcing tenancy in TypeScript application code. We've covered the neighboring layers elsewhere. The full dashboard and embedding story, including schema design, projections, and per-tenant quotas, is in the [embedded analytics guide](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards). ClickHouse-native row policies and per-tenant database users get a full treatment in the [row-level security post](/blog/clickhouse-row-level-security-typescript). Here we assume a shared table with a `tenant_id` column and work through how the library layer keeps tenants apart.

If you want to follow along with typed queries against your own schema, the [quick start](/docs/quick-start) gets you generated types in a few minutes, and the [multi-tenant analytics overview](/clickhouse-multi-tenant-analytics) covers the architecture at a higher level.

## The baseline: a shared table with tenant_id in the sort key

Everything below assumes the standard shared-table model:

```sql
CREATE TABLE orders (
  tenant_id String,
  id String,
  region LowCardinality(String),
  status LowCardinality(String),
  total Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

`tenant_id` first in `ORDER BY` means ClickHouse's sparse primary index skips granules belonging to other tenants entirely. A tenant-scoped query reads data proportional to that tenant's size, not the table's size. This is why the shared-table model works: isolation is a correctness problem, not a performance problem.

The correctness problem is what the rest of this post is about. Every query that reaches this table must carry `WHERE tenant_id = ?`. The question is where that guarantee lives.

## Level 1: builder-level filters (explicit, but manual)

The most direct pattern is a typed filter in every query function:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export async function revenueByRegion(tenantId: string) {
  return db
    .table('orders')
    .select(['region'])
    .sum('total', 'revenue')
    .where('tenant_id', 'eq', tenantId)
    .where('status', 'eq', 'completed')
    .groupBy('region')
    .orderBy('revenue', 'DESC')
    .execute();
}
```

This is fine as far as it goes. The filter is visible, typed, and parameterized. The generated SQL is exactly what you'd write by hand:

```sql
SELECT region, SUM(total) AS revenue
FROM orders
WHERE tenant_id = ? AND status = ?
GROUP BY region
ORDER BY revenue DESC
```

The problem is discipline at scale. With thirty query functions and five engineers, "remember the tenant filter" is a code-review convention, not a guarantee. One forgotten `.where` on one endpoint leaks another tenant's revenue numbers. The type system can't help you here: a query without a tenant filter is perfectly valid TypeScript.

So treat level 1 as the floor. The next two levels move the guarantee out of individual query functions and into infrastructure.

## Level 2: inject the tenant once, at the API boundary

With [@hypequery/serve](/use-cases/multi-tenant-saas), queries run against a context object built per request. That's the right place to resolve the tenant, once, from your auth token, so query definitions never accept a tenant id from the client:

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';
import { tenantFromRequest } from './auth.js'; // your JWT/session decoding

const { query, serve } = initServe({
  basePath: '/api/analytics',
  context: ({ request }) => {
    const tenantId = tenantFromRequest(request);
    if (!tenantId) throw new Error('Unauthenticated');
    return { db, tenantId };
  },
});

const revenueByRegion = query({
  description: 'Revenue by region for the calling tenant',
  input: z.object({ status: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select(['region'])
      .sum('total', 'revenue')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('status', 'eq', input.status)
      .groupBy('region')
      .execute(),
});

export const api = serve({ queries: { revenueByRegion } });
```

Two properties matter here.

**The tenant id never crosses the wire.** `input` is what the client sends; `ctx` is what the server derives. A client cannot pass `tenantId: 'someone-else'` because no input schema accepts it. This is the single most common multi-tenant bug in analytics APIs, and this structure makes it unrepresentable.

**Tenant resolution happens in exactly one place.** When you rotate your auth provider or change how tenant claims are encoded, you edit one context factory, not every endpoint.

What level 2 does not solve: each query body still contains its own `.where('tenant_id', ...)` line. The context guarantees the right tenant id is available; it doesn't guarantee anyone used it. That's what the dataset layer is for.

## Level 3: tenantKey on datasets (enforcement at plan time)

[@hypequery/datasets](/clickhouse-semantic-layer) lets you declare the tenant column once, on the dataset definition, and then refuses to plan any query that isn't tenant-scoped:

```ts
import { dataset, dimension, measure, eq, createDatasetClient } from '@hypequery/datasets';
import { db } from './client.js';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
    completedRevenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
  },
});

const analytics = createDatasetClient({ queryBuilder: db });

const result = await analytics.execute(
  Orders,
  { dimensions: ['region'], measures: ['revenue'] },
  { runtime: { tenant: tenantId } },
);
// result.data → [{ region: 'EU', revenue: '48210.50' }, ...]
```

The planner injects `WHERE tenant_id = ?` into the generated SQL before anything else is applied. Callers describe *what* they want (dimensions, measures, ordering); tenancy is not part of the query vocabulary at all.

The enforcement is strict in both directions:

```ts
// 1. No tenant context at all → rejected before any SQL runs:
await analytics.execute(Orders, { measures: ['revenue'] });
// Error: Dataset "orders" requires runtime tenant scoping.

// 2. Trying to filter on the tenant field manually → also rejected:
await analytics.execute(
  Orders,
  { measures: ['revenue'], filters: [eq('tenant_id', 'tenant-123')] },
  { runtime: { tenant: 'tenant-123' } },
);
// Error: Cannot filter on tenant field "tenant_id" when runtime
// tenancy enforcement is active.
```

That second rejection is deliberate. If callers could add their own tenant filters, a confused endpoint might filter for one tenant while the runtime context says another. There must be exactly one source of truth for tenancy, and it's the runtime context.

For the legitimate exceptions, the scoping is explicit rather than absent:

```ts
// Internal admin job across a set of tenants → IN predicate:
{ runtime: { tenant: { in: ['tenant-1', 'tenant-2'] } } }

// Deliberate cross-tenant aggregation (internal reporting only):
{ runtime: { tenant: { scope: 'all' } } }
```

`scope: 'all'` omits the tenant predicate entirely, but it has to be written down. A cross-tenant query in your codebase is now greppable, reviewable, and impossible to hit by forgetting something.

Levels 2 and 3 compose naturally: the serve context resolves `tenantId` from auth, and datasets exposed through `serve({ datasets: { orders: Orders } })` carry the same plan-time guarantee over HTTP. One declaration in the dataset, one resolution in the context factory, and every consumer, whether in-process, [React hooks](/clickhouse-react), or an AI agent over MCP, inherits the scoping.

## Why defense-in-depth beats either layer alone

ClickHouse row policies enforce filtering at the database level, regardless of what SQL arrives. The strict form binds a policy per tenant user (`USING tenant_id = 'acme'` on a per-tenant role), which the [row-level security post](/blog/clickhouse-row-level-security-typescript) covers in full.

So why not rely on them exclusively? Two practical reasons:

- **Operational cost.** Row policies bind to database users. Per-tenant enforcement means per-tenant ClickHouse users: provisioning on signup, credential rotation, lifecycle management. Fine for dozens of tenants, painful for thousands.
- **Granularity.** Your application knows things ClickHouse doesn't: which workspace within a tenant, which role the caller has, whether this is an admin session allowed to run `scope: 'all'`. App-layer enforcement operates on the request; row policies operate on the connection.

And the reverse question, why not app-layer only, has an equally honest answer: application code has bugs. A raw SQL escape hatch, a script run outside the serve boundary, a migration tool with the shared credential. None of these pass through your dataset planner.

The strongest position is both:

1. **App layer as the primary mechanism.** `tenantKey` + serve context give per-request granularity, one shared connection, and enforcement that fails loudly at plan time during development, not silently in production.
2. **Row policies as the backstop.** A coarse policy on the shared application user (or a small set of role users) caps the blast radius of any bug in layer 1. It doesn't need per-tenant users to be worth having; even a policy that blocks reads without a `tenant_id` predicate catches the catastrophic cases.

Each layer covers the other's failure mode. The app layer catches what the database can't see (request-level identity); the database catches what the app layer can't guarantee (code that bypasses it).

## Where to go from here

- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics) — the architecture overview this post plugs into
- [Multi-tenant SaaS use case](/use-cases/multi-tenant-saas) — how the serve + datasets stack fits a SaaS backend end to end
- [Row-level security in ClickHouse with TypeScript](/blog/clickhouse-row-level-security-typescript) — the database side of defense-in-depth
- [Embedded analytics with ClickHouse](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards) — schema design, projections, and quotas for customer-facing dashboards
