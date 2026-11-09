---
title: "Multi-Tenant Embedded Analytics Architecture on ClickHouse"
description: "How to build secure multi-tenant embedded analytics on ClickHouse: shared tables, row policies vs app-side tenant scoping, a typed tenant-scoped API, dashboard performance, quotas, and tenant offboarding."
seoTitle: "Multi-Tenant Embedded Analytics Architecture on ClickHouse"
seoDescription: "Multi-tenant embedded analytics architecture on ClickHouse: shared tables, row policies plus app-side tenant scoping, a typed API, quotas, fast dashboards."
pubDate: 2026-04-30
updated: 2026-11-09
heroImage: ""
slug: embedded-analytics-clickhouse-multi-tenant-dashboards
status: published
tags:
  - ClickHouse
  - TypeScript
  - Embedded analytics
---

Customers expect usage dashboards and reporting inside your product. Not in a separate BI tool, but inside your app, loading fast, showing only their data. ClickHouse is one of the best engines for this, and teams like PostHog, LaunchDarkly, Grafana Cloud, GitLab, Cloudflare, and Inigo have all built customer-facing analytics on it. What they all also discovered is that the hard part is not query performance. It is multi-tenancy, isolation, and keeping the codebase maintainable as you scale to thousands of tenants.

This guide covers the full picture: schema design, row-level security and app-side tenant scoping, a typed tenant-scoped API, dashboard performance, per-tenant resource limits, and onboarding and offboarding tenants. Every SQL statement here was run on a ClickHouse 26.6 server, including the row policies, quotas and read-only users.

## Quick answers

### How do you secure multi-tenant embedded analytics?

Put every tenant in one shared table with `tenant_id` first in the sort key. Resolve the tenant on the server from the user's verified session, never from request input. Apply the tenant filter in one place in your API layer, and add a ClickHouse row policy underneath so a bug in application code still cannot read another tenant's rows.

### Does ClickHouse have row-level security?

Yes, through row policies: `CREATE ROW POLICY ... USING tenant_id = ...`. Unlike Postgres RLS, a policy is attached to ClickHouse users or roles, not to a session variable, so the scaling trick is a single role whose policy reads a per-query custom setting. See [row-level security done right](#row-level-security-done-right).

### Row policies or app-side tenant scoping?

Both. App-side scoping knows who the user is and which workspace or role they have. Row policies cover code that bypasses your API: a script, a migration tool, a raw SQL escape hatch. The [comparison below](#row-policies-vs-app-side-tenant-scoping) shows what each one catches.

### What does a multi-tenant embedded analytics architecture look like?

One shared ClickHouse table per event type, one read-only database user with a tenant row policy, and one typed API layer that injects the tenant into every query. The [architecture section](#multi-tenant-embedded-analytics-architecture) shows each layer.

## Multi-Tenant Embedded Analytics Architecture

A multi-tenant embedded analytics stack on ClickHouse has four layers, and each one has a single job:

1. **Storage.** One shared table per event type, with `tenant_id` first in the sort key, so a tenant's query reads only that tenant's part of the data. See [the schema that scales](#the-schema-that-scales).
2. **Database guard.** A read-only role with a row policy that reads the tenant from a per-query setting, plus settings profiles and keyed quotas per plan tier, so a bug or a heavy tenant can't reach other tenants' rows or starve them. See [row-level security done right](#row-level-security-done-right) and [resource isolation](#resource-isolation-and-noisy-neighbors).
3. **API layer.** The server resolves the tenant from the verified session and injects the tenant filter into every query in one place; datasets reject queries that would bypass the tenant key. See [enforcing tenancy at plan time](#enforcing-tenancy-at-plan-time-with-datasets).
4. **Dashboard.** React components call typed endpoints. The browser never sends SQL or a tenant id. See [a typed analytics API](#a-typed-analytics-api-for-your-dashboards).

```text
Next.js App Router
  └── app/api/analytics/[...path]/route.ts
        └── createFetchHandler(api.handler)
              └── serve({ tenant: { extract, column: 'tenant_id' } })
                    ├── auth: session → { userId, tenantId }
                    ├── queries: ctx.db.table(...) gets WHERE tenant_id = ?
                    ├── datasets: tenantKey enforced at plan time
                    └── context: per-request ctx.db sends { SQL_tenant_id, quota_key }

ClickHouse
  ├── events: ORDER BY (tenant_id, event_time, event_id)
  ├── projection: (tenant_id, hour, event_type) → count()
  ├── row policy: tenant_id = getSetting('SQL_tenant_id')
  ├── role settings: SQL_tenant_id CHANGEABLE_IN_READONLY
  ├── settings profile per plan tier
  └── quota KEYED BY client_key
```

The rest of this guide builds each layer, in that order.

---

## Why ClickHouse for Embedded Analytics

ClickHouse is a column-oriented OLAP database built for fast aggregations over large, append-heavy datasets: product usage events, billing usage, per-customer time series. Keep transactional data (users, accounts, subscriptions) in Postgres or MySQL, and put the events your dashboards aggregate in ClickHouse.

---

## Three Isolation Models, and Which One to Choose

Before writing a line of SQL, decide how tenant data is physically stored.

### Model 1: Shared Table (recommended default)

A single events table with `tenant_id` in the primary key. All tenants share the same schema, the same table and the same cluster. It works for thousands of tenants and keeps operational overhead low. Isolation comes from the API layer and a row policy, both covered below.

### Models 2 and 3: Separate Tables or Databases per Tenant

A dedicated `events_acme` table, or a database per tenant, suits a handful of large customers with different schemas or compliance terms. It does not scale to hundreds of tenants: every table adds parts to merge and another target for every schema migration.

**In short:** start with a shared table. Move individual enterprise accounts to their own database or ClickHouse service only when a contract requires it. ClickHouse Cloud can also run [separate compute services over the same data](https://clickhouse.com/docs/cloud/reference/warehouses) if a large customer needs dedicated compute without a data copy.

---

## The Schema That Scales

For the shared-table model, the most important decision is where `tenant_id` sits in the sort key.

```sql
CREATE TABLE events
(
    tenant_id   UInt32,
    event_id    UUID DEFAULT generateUUIDv4(),
    event_time  DateTime64(3),
    user_id     UInt64,
    event_type  LowCardinality(String),
    properties  Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_id);
```

**`tenant_id` goes first in `ORDER BY`.** ClickHouse's sparse primary index follows the sort key, so a query for one tenant skips the granules of every other tenant. A tenant-scoped query reads data in proportion to that tenant's size, not the table's.

**Partition by time, not by tenant.** `PARTITION BY (tenant_id, toYYYYMM(event_time))` multiplies the number of parts by the number of tenants, and too many parts slows merges and inserts. Partition by time and let the primary key do per-tenant pruning. The exception is fast deletion for a few large tenants, covered in [offboarding](#tenant-onboarding-and-offboarding).

**64-bit values and dates arrive as strings.** `DateTime64` columns come back from the HTTP interface as `"YYYY-MM-DD hh:mm:ss.sss"` strings, not `Date` objects. Since ClickHouse 25.8 the server sends `UInt64` and `Int64` as plain JSON numbers by default, which lose precision above 2^53 in JavaScript. hypequery asks for quoted values (`output_format_json_quote_64bit_integers = 1`), so `user_id` and every `count()` arrive as exact strings. Convert them at the display layer.

---

## Row-Level Security Done Right

Shared tables need an enforcement layer in the database as well as in the application. ClickHouse row policies provide it, and there are two patterns with very different operational costs.

### The Per-Tenant-User Approach (works for tens of tenants)

```sql
CREATE ROLE tenant_42_role;
GRANT SELECT ON events TO tenant_42_role;

CREATE ROW POLICY tenant_42_policy ON events
  FOR SELECT USING tenant_id = 42
  TO tenant_42_role;

CREATE USER tenant_42_user IDENTIFIED BY 'strong_password'
  SETTINGS readonly = 1;
GRANT tenant_42_role TO tenant_42_user;
```

Even `SELECT * FROM events` run as `tenant_42_user` returns only tenant 42's rows. The cost is one user, one role and one policy per tenant per table. You provision users at signup, rotate credentials, and your app needs a separate ClickHouse client per tenant, because credentials belong to the connection. That is fine for a few dozen tenants and painful for thousands.

### The Custom-Setting Approach (works for thousands of tenants)

Use one shared database user. The application passes the tenant as a per-query custom setting, and a single row policy reads it.

```sql
-- The role lets a read-only user change the custom setting
CREATE ROLE analytics_readonly;
ALTER ROLE analytics_readonly SETTINGS SQL_tenant_id CHANGEABLE_IN_READONLY;
GRANT SELECT ON events TO analytics_readonly;

-- One row policy reads the per-query setting
CREATE ROW POLICY tenant_isolation ON events
  FOR SELECT
  USING tenant_id = getSetting('SQL_tenant_id')::UInt32
  TO analytics_readonly;

-- One shared database user for the whole application
CREATE USER app_analytics IDENTIFIED BY 'strong_password'
  SETTINGS readonly = 1;
GRANT analytics_readonly TO app_analytics;
SET DEFAULT ROLE analytics_readonly TO app_analytics;
```

What we saw running this on ClickHouse 26.6:

- **It fails closed.** A query without `SQL_tenant_id` fails with `Unknown setting 'SQL_tenant_id'`. There is no path where a missing tenant silently returns every tenant's rows.
- **A spoofed filter returns nothing.** `WHERE tenant_id = 41` with `SQL_tenant_id = '42'` returns zero rows, because the policy is ANDed with the query.
- **`CHANGEABLE_IN_READONLY` is required.** Without it, every query fails with `Cannot modify 'SQL_tenant_id' setting in readonly mode`.
- **The policy prunes the primary index.** With the policy alone, `EXPLAIN indexes = 1` showed `Condition: (tenant_id in [42, 42])` and read the same granules as an explicit `WHERE tenant_id = 42`. Keep the explicit filter in your queries anyway: it documents intent and keeps working if the policy is ever dropped.

Two setup details. Custom settings only work if their prefix is listed in the `custom_settings_prefixes` [server setting](https://clickhouse.com/docs/operations/server-configuration-parameters/settings); our test server listed `SQL_`, so check yours. And adding tenant 10,001 needs no DDL at all.

### The read-only user and hypequery's precision setting

A `readonly = 1` user rejects any setting it is not explicitly allowed to change. hypequery sends `output_format_json_quote_64bit_integers = 1` on every query, so with the user above every hypequery query fails with `Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode`. Fix it on the role, so the value hypequery sends matches the profile:

```sql
ALTER ROLE analytics_readonly SETTINGS
  SQL_tenant_id CHANGEABLE_IN_READONLY,
  output_format_json_quote_64bit_integers = 1;
```

Or use `readonly = 2`, which still blocks writes and DDL but accepts per-query settings. The [read-only users reference](/docs/reference/readonly-users) covers both options.

---

## Row Policies vs App-Side Tenant Scoping

ClickHouse's row policies and your application's tenant scoping protect against different failures. Use both.

| | Row policy (custom setting) | App-side scoping (API layer) |
|---|---|---|
| Where it runs | ClickHouse, on every query from the role | Your backend, on every API request |
| What it knows | The tenant ID the app passed | The verified user, workspace, roles and plan |
| Catches | Scripts, migration tools and raw SQL that bypass your API | A client asking for another tenant's data, missing role checks |
| Misses | A bug that passes the wrong tenant ID | Code that does not go through the API layer |
| Cost | One role and one policy per table | One context function and a tenant config |

The app layer is the primary mechanism, because only it knows who is asking. The row policy caps the blast radius of a bug in it. Neither replaces the other: if your app passes the wrong tenant in `SQL_tenant_id`, the policy enforces the wrong tenant.

The one rule that matters most for the app layer: **the tenant ID never comes from request input.** If a query accepts `tenantId` in its input schema, a client can send someone else's. Derive it from the session on the server.

---

## Wiring Tenant Context Through Your Application

### Without an abstraction layer

With the official `@clickhouse/client`, pass the tenant twice: as a bound query parameter and as the row-policy setting.

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: 'app_analytics',
  password: process.env.CLICKHOUSE_PASSWORD,
});

export async function eventCounts(tenantId: number) {
  const result = await client.query({
    query: `
      SELECT event_type, count() AS total_events
      FROM events
      WHERE tenant_id = {tenantId:UInt32}
        AND event_time >= now() - INTERVAL 7 DAY
      GROUP BY event_type
      ORDER BY total_events DESC
    `,
    query_params: { tenantId },
    clickhouse_settings: {
      SQL_tenant_id: String(tenantId),
      quota_key: String(tenantId),
    },
    format: 'JSONEachRow',
  });
  return result.json<{ event_type: string; total_events: string }>();
}
```

This works, but every function must remember both lines, and nothing stops a handler passing a `tenantId` read from the query string.

### With a typed query layer

[hypequery](https://github.com/hypequery/hypequery)'s serve runtime resolves the tenant once per request from your auth strategy, then injects it for you. With `tenant.column` set, every `ctx.db.table(...)` call in a query gets `WHERE tenant_id = <tenant>` added automatically, and requests without a tenant are rejected.

```typescript
import { createClient } from '@clickhouse/client';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import type { IntrospectedSchema } from './schema';
import { verifySession } from './auth'; // your JWT or session check

// One connection pool for the app.
const client = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: 'app_analytics',
  password: process.env.CLICKHOUSE_PASSWORD,
});

// A per-request builder on that pool. Every query it runs, hand-written or
// dataset, sends the tenant's row-policy setting and quota key.
const tenantDb = (tenantId: string) =>
  createQueryBuilder<IntrospectedSchema>({
    client,
    clickhouse_settings: { SQL_tenant_id: tenantId, quota_key: tenantId },
  });

type AppAuth = { userId: string; tenantId: string };

const { query, serve } = initServe({
  basePath: '/api/analytics',
  auth: async ({ request }): Promise<AppAuth | null> => {
    const token = request.headers['authorization']?.replace('Bearer ', '');
    return token ? verifySession(token) : null;
  },
  // No session means no settings: the row policy and quota fail the query closed.
  context: ({ auth }) => ({ db: tenantDb(auth?.tenantId ?? '') }),
});

const eventCounts = query({
  description: 'Event counts by type for the last N days',
  input: z.object({ days: z.number().int().min(1).max(90).default(7) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events') // tenant filter injected here
      .select(['event_type'])
      .count('event_id', 'total_events')
      .where((expr) =>
        expr.fn('greaterOrEquals', expr.col('event_time'),
          expr.fn('subtractDays', expr.fn('now'), input.days)),
      )
      .groupBy(['event_type'])
      .orderBy('total_events', 'DESC')
      .execute(),
});

export const api = serve({
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
    column: 'tenant_id',
  },
  queries: { eventCounts },
});
```

Three things to notice:

- **`input` is what the client sends; `ctx` is what the server derives.** No input schema accepts a tenant, so a client cannot ask for one.
- **Tenant resolution lives in one place.** Change auth providers and you edit `auth` and `extract`, not every endpoint.
- **The ClickHouse settings live in one place too.** `context` builds `ctx.db` per request, so no query can forget `SQL_tenant_id` or `quota_key`.
- **Exceptions are explicit.** An internal admin query opts out with a per-query override, `tenant: { required: false, mode: 'manual' }`, which is easy to grep for in review. The [multi-tenancy docs](/docs/multi-tenancy) cover the options.

One caveat from the docs: calling a query definition's own `.execute()` directly skips the tenant pipeline. Run tenant-scoped queries through `api.run(...)`, `api.execute(...)` or HTTP.

Mount it in the Next.js App Router at `app/api/analytics/[...path]/route.ts`:

```typescript
import { createFetchHandler } from '@hypequery/serve';
import { api } from '@/analytics/api';

const handler = createFetchHandler(api.handler);

export const runtime = 'nodejs';
export const GET = handler;
export const POST = handler;
```

---

## Enforcing Tenancy at Plan Time with Datasets

Serve's tenant column scopes hand-written builder queries. For metrics that many dashboards share, [`@hypequery/datasets`](/clickhouse-semantic-layer) goes further: declare the tenant column once on the dataset, and the planner refuses to build an unscoped query.

```typescript
import { createDatasetClient, dataset, dimension, eq, measure } from '@hypequery/datasets';
import { db } from './client';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    tenantId: dimension.string({ column: 'tenant_id' }),
    region: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
    orderCount: measure.count('id'),
  },
});

const analytics = createDatasetClient({ queryBuilder: db });

const result = await analytics.execute(
  Orders,
  { dimensions: ['region'], measures: ['revenue'] },
  { runtime: { tenant: 'tenant_123' } },
);
```

The tenant predicate is added before anything else, and enforcement is strict in both directions:

- No tenant context fails with `Invalid dataset query: Dataset "orders" requires runtime tenant scoping.`
- A caller filtering on the tenant field fails with `Cannot filter on tenant field "tenantId" when runtime tenancy enforcement is active.`

The second rule stops an endpoint from filtering for one tenant while the runtime context says another. Legitimate exceptions are written down: `{ tenant: { in: ['t1', 't2'] } }` for a known set of tenants, `{ tenant: { scope: 'all' } }` for trusted internal jobs. A cross-tenant query is now something you can grep for.

---

## A Typed Analytics API for Your Dashboards

The same `serve()` call can publish hand-written queries, datasets and metrics as one HTTP API. Datasets registered here use the serve tenant identity and their own `tenantKey`, and they run on the request's `ctx.db`, so they send the same `SQL_tenant_id` and `quota_key` as the queries:

```typescript
export const api = serve({
  tenant: { extract: (auth) => auth.tenantId, required: true, column: 'tenant_id' },
  queries: { eventCounts },
  datasets: { orders: Orders },
});
```

The role needs `SELECT` on `orders` and a row policy of its own there, because policies are per table.

Each query gets a validated route, such as `GET /api/analytics/queries/eventCounts?days=7`; the zod schema rejects bad input before any SQL runs, and a request without a session gets a 401. Datasets get `POST /api/analytics/datasets/orders/query`. Serve also publishes an OpenAPI document at `/api/analytics/openapi.json` with interactive docs at `/api/analytics/docs`, generated from the same definitions, so the docs cannot drift from the code. With a required tenant, those two routes need a signed-in tenant too. See [HTTP and OpenAPI](/docs/http-openapi).

On the frontend, import only the API's type, plus a route manifest generated with `npx hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json`:

```tsx
import { createHooks } from '@hypequery/react';
import type { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/api';
import manifest from '@/analytics/hypequery-manifest.json';
import { getSessionToken } from '@/lib/auth'; // your auth SDK's client-side token getter

export const { useQuery } = createHooks<InferApiType<typeof api>>({
  baseUrl: '/api/analytics',
  manifest,
  // The server's auth reads a bearer token, so send one with every request.
  token: () => getSessionToken(),
});

export function EventCountsWidget() {
  const { data, isLoading, error } = useQuery('eventCounts', { days: 7 });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Could not load events.</p>;
  return (
    <ul>
      {data?.map((row) => (
        <li key={row.event_type}>
          {row.event_type}: {Number(row.total_events).toLocaleString()}
        </li>
      ))}
    </ul>
  );
}
```

`import type` keeps the server code and the ClickHouse client out of the browser bundle. Rename a column, run `npx hypequery generate`, and the compiler flags every query and component that used the old name. The [React and Next.js dashboard guide](/blog/building-dashboards-clickhouse-hypequery-nextjs) builds out the frontend side.

---

## Making Dashboards Feel Instant

### Aggregate Projections

A projection stores a precomputed aggregation inside the same parts as the base table. When a query matches it, ClickHouse reads the projection automatically, with no application changes.

```sql
ALTER TABLE events ADD PROJECTION hourly_event_counts
(
  SELECT
    tenant_id,
    toStartOfHour(event_time) AS hour,
    event_type,
    count() AS total_events
  GROUP BY tenant_id, hour, event_type
);

-- Build it for existing data
ALTER TABLE events MATERIALIZE PROJECTION hourly_event_counts;
```

`EXPLAIN` on an hourly per-tenant count then shows `ReadFromMergeTree (hourly_event_counts)`. One trade-off: on 26.6, `DELETE FROM` on a table with projections throws unless you change the table's `lightweight_mutation_projection_mode` setting.

### Incremental Materialized Views

For pre-aggregations a projection can't express (joins at insert time, separate retention), write to an `AggregatingMergeTree` table:

```sql
CREATE TABLE events_hourly_agg
(
    tenant_id    UInt32,
    hour         DateTime,
    event_type   LowCardinality(String),
    total_events AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, event_type);

CREATE MATERIALIZED VIEW events_hourly_mv TO events_hourly_agg AS
SELECT
    tenant_id,
    toStartOfHour(event_time) AS hour,
    event_type,
    countState() AS total_events
FROM events
GROUP BY tenant_id, hour, event_type;
```

Read it with `countMerge(total_events)` and `WHERE tenant_id = 42`. Put the row policy on this table too: policies are per table. The [materialized views guide](/blog/a-guide-to-materialized-views-in-clickhouse) covers backfills and engine choice.

### Query Condition Cache

ClickHouse caches which granules matched a `WHERE` condition, so repeated dashboard queries with the same filter can skip granules on later runs. On 26.6 it is on by default (`use_query_condition_cache = 1`).

---

## Resource Isolation and Noisy Neighbors

### Settings Profiles per Plan Tier

```sql
CREATE SETTINGS PROFILE free_tier
  SETTINGS max_memory_usage = 1073741824,
           max_execution_time = 10,
           max_threads = 2,
           priority = 10;

ALTER USER app_analytics SETTINGS PROFILE 'free_tier';
```

Profiles attach to users, so per-plan limits mean one ClickHouse user per tier, not per tenant.

### Keyed Quotas for Per-Tenant Rate Limits

A quota keyed by `client_key` tracks usage separately for each `quota_key` value, which your app sets to the tenant ID:

```sql
CREATE QUOTA tenant_quota
  KEYED BY client_key
  FOR INTERVAL 1 MINUTE MAX queries = 30,
  FOR INTERVAL 1 HOUR MAX queries = 500, read_rows = 10000000000
  TO analytics_readonly;
```

Both snippets above already pass `quota_key`. On our test server, the fourth query in a minute with `MAX queries = 3` failed with `QUOTA_EXCEEDED` while another tenant's key kept working, and a query with no `quota_key` failed with `QUOTA_REQUIRES_CLIENT_KEY`. Note that `KEYED BY 'quota_key'`, which appears in some older guides, is a syntax error. Use `client_key_or_user_name` if you want a fallback instead of a failure.

Quotas are a protection layer, not a billing ledger. Keep durable per-tenant usage counts in your own tables.

### Query Cancellation

Dashboards abandon queries when users navigate away. Pass the request's abort signal through so the HTTP request to ClickHouse closes:

```typescript
const rows = await db
  .table('events')
  .select(['event_type'])
  .count('event_id', 'total_events')
  .where('tenant_id', 'eq', tenantId)
  .groupBy(['event_type'])
  .settings({ SQL_tenant_id: String(tenantId), quota_key: String(tenantId) })
  .execute({ abortSignal: request.signal });
```

ClickHouse only cancels a read-only query when its client disconnects if `cancel_http_readonly_queries_on_client_close = 1`, which is off by default on 26.6; put it in the user's profile. `max_execution_time` in the profile is the hard backstop.

---

## Tenant Onboarding and Offboarding

**Onboarding** with the custom-setting policy needs no ClickHouse DDL.

**Offboarding** has three options:

```sql
-- Partition drop: only if tenant_id is in PARTITION BY
ALTER TABLE events DROP PARTITION tuple(42, 202501);

-- Lightweight delete: the general-purpose default
DELETE FROM events WHERE tenant_id = 42;
```

Lightweight deletes mark rows as deleted at once and remove them during background merges. If the table has projections, set `lightweight_mutation_projection_mode` first, as above. A composite partition key buys fast drops at the cost of more parts, so keep it to tables with a small number of large tenants.

**Per-tenant usage** is already in `system.query_log`: the `Settings` column records the custom setting each query sent. String values are stored with their quotes, so strip them:

```sql
SELECT
    toUInt32OrZero(trimBoth(Settings['SQL_tenant_id'], '''')) AS tenant_id,
    count() AS queries,
    sum(read_rows) AS rows_read,
    sum(query_duration_ms) AS total_ms
FROM system.query_log
WHERE type = 'QueryFinish'
  AND Settings['SQL_tenant_id'] != ''
  AND event_date >= today() - 30
GROUP BY tenant_id
ORDER BY rows_read DESC;
```

---

## Common Mistakes

**Accepting the tenant ID as input.** The most common multi-tenant bug in analytics APIs. Derive it from the session.

**Putting `tenant_id` after time in the sort key.** `ORDER BY (event_time, tenant_id)` makes every tenant query scan a time range across all tenants.

**Partitioning by tenant at scale.** Fine for dozens of tenants, a parts-count problem at thousands.

**Forgetting `CHANGEABLE_IN_READONLY`, or hypequery's precision setting, on a `readonly = 1` role.** Every query fails. Test this in your integration tests against a real read-only user.

**One row policy, many tables.** Policies are per table. A rollup table without one is an unguarded copy of every tenant's data.

**Tiny inserts.** Batch writes, or use [async inserts](https://clickhouse.com/docs/optimize/asynchronous-inserts).

---

## Closing

Four decisions carry most of the weight: a shared table with `tenant_id` first in the sort key, a tenant resolved from the session and injected by one API layer, a custom-setting row policy as the backstop, and per-tenant limits through profiles and keyed quotas. For the architecture overview, see [ClickHouse multi-tenant analytics](/clickhouse-multi-tenant-analytics) and the [multi-tenant SaaS use case](/use-cases/multi-tenant-saas).
