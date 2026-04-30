---
title: "Embedded Analytics with ClickHouse: A Practical Guide to Multi-Tenant Dashboards"
description: "A practical guide to building multi-tenant embedded analytics on ClickHouse with typed TypeScript query layers, row-policy isolation, projections, quotas, and operational patterns that scale."
seoTitle: "Embedded Analytics with ClickHouse for Multi-Tenant Dashboards"
seoDescription: "Learn how to build fast, secure multi-tenant embedded analytics with ClickHouse using shared tables, row policies, typed query layers, projections, quotas, and tenant-aware operations."
pubDate: 2026-04-30
heroImage: ""
slug: embedded-analytics-clickhouse-multi-tenant-dashboards
status: published
---

Customers expect usage dashboards and reporting inside your product. Not in a separate BI tool, but inside your app, loading fast, showing only their data. ClickHouse is one of the best engines for this, and teams like PostHog, LaunchDarkly, Grafana Cloud, GitLab, Cloudflare, and Inigo have all built customer-facing analytics on it. What they all also discovered is that the hard part is not query performance. It is multi-tenancy, isolation, and keeping the codebase maintainable as you scale to thousands of tenants.

This guide covers the full picture: schema design, row-level security done properly, performance optimization with materialized views and ClickHouse's newer caching primitives, per-tenant resource isolation, and the operational realities of onboarding and offboarding at scale.

---

## Why ClickHouse for Embedded Analytics

ClickHouse is a column-oriented OLAP database designed for fast aggregations over large datasets. It can serve many concurrent dashboard queries without the write-path penalties that come with row-oriented databases, which makes it a natural fit for:

- Product usage dashboards (events, sessions, feature flags)
- Billing and subscription analytics
- Time-series metrics at per-customer granularity
- Any aggregation by tenant, team, account, or workspace

The short version of why it beats Postgres for this workload: on a 200M-row events table, a cold scan for last-24h event counts takes around 1.4 seconds. Add an aggregate projection and you are at around 12ms. Add ClickHouse 25.3's Query Condition Cache and repeat loads are under 50ms even without precomputed aggregates. None of that is achievable with a general-purpose OLTP database.

---

## Three Isolation Models, and Which One to Choose

Before writing a line of SQL, you need to decide how tenant data is physically stored. ClickHouse supports three main approaches, and the right choice depends on a few practical factors.

### Model 1: Shared Table (recommended default)

A single events table with `tenant_id` in the primary key. All tenants share the same schema, same table, same cluster. This is what PostHog (column: `team_id`), Grafana Cloud, and most SaaS analytics products use.

It works for tens of thousands of tenants, scales to petabytes without sharding complexity, and keeps operational overhead minimal. The isolation layer is ClickHouse's row policy system, covered in detail below.

### Model 2: Separate Tables per Tenant

A dedicated `events_acme`, `events_globex`, and so on for each customer. This makes sense if tenants have meaningfully different schemas or if you have a small number of very large customers. It does not scale to hundreds of tenants. ClickHouse starts degrading past a few thousand parts per table, and managing schema migrations across N tables becomes painful fast.

### Model 3: Separate Databases per Tenant

A separate ClickHouse database per tenant. Better logical separation than separate tables, with cleaner permission scoping. It still does not scale to thousands of tenants for the same reasons. Altinity's knowledge base puts the practical ceiling around a few hundred before operational overhead becomes the dominant cost.

### When to Consider Stronger Isolation

If you have enterprise customers with contractual data residency requirements, ClickHouse Cloud's compute-compute separation ("Warehouses") lets you run isolated compute services over the same shared data without copying anything. Full separate ClickHouse services per tenant are only justified by compliance requirements. The operational cost is significant.

**Decision tree in short:** start with a shared table. Move to separate databases for a handful of enterprise accounts where schema or compliance requirements diverge. Use Warehouses (Cloud) or separate services only when you have a contractual obligation to do so.

---

## The Schema That Scales

For the shared-table model, the most important decision is where `tenant_id` sits in the sort key.

```sql
CREATE TABLE events
(
    tenant_id   UInt32,
    event_id    UUID,
    event_time  DateTime64(3),
    user_id     UInt64,
    event_type  LowCardinality(String),
    properties  Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time, event_id);
```

A few things worth being precise about here:

**`tenant_id` goes first in `ORDER BY`.** ClickHouse's sparse primary index is based on the sort key. Putting `tenant_id` first means that per-tenant scans skip granules from other tenants entirely, rather than scanning the full table and filtering afterward. Without this, tenant queries scan data proportionally to total table size, not tenant data size.

**Partition by time, not by tenant.** A common mistake is `PARTITION BY (tenant_id, toYYYYMM(event_time))`. This is fine for fewer than about 50 tenants. Beyond that you'll blow past ClickHouse's recommended part counts. The database starts creating too many parts to merge efficiently, and performance degrades. For multi-thousand-tenant SaaS, partition by time only and rely on the primary key for per-tenant pruning.

The one exception: if fast per-tenant data deletion is a hard requirement, such as GDPR offboarding or plan expiry, a composite partition key lets you drop entire partitions with `ALTER TABLE events DROP PARTITION tuple(42, 202501)` rather than waiting for a slow mutation. If that tradeoff matters for your use case, limit the partition-by-tenant approach to a small number of high-value accounts.

**`DateTime` columns return as strings.** When `@clickhouse/client` (and by extension hypequery) reads `DateTime64` values, they come back as `"YYYY-MM-DD HH:MM:SS.mmm"` strings, not `Date` objects. `UInt64` commonly comes back as a string too for precision safety. Parse them explicitly in your application layer.

---

## Row-Level Security Done Right

Shared tables need an enforcement layer. ClickHouse's row policies handle this, but there are two distinct patterns with very different production characteristics.

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

Simple and easy to reason about. The problem is that it does not scale: you're creating N users, N roles, and N policies per table. At 10,000 tenants across 50 tables, that is 500,000 row-policy objects. Migrations, audits, and connection management become unworkable.

There is also a critical operational issue: ClickHouse connection pooling uses a fixed set of credentials. If you need one ClickHouse user per tenant, you need one connection pool per tenant, or you reconnect on every request, which destroys throughput.

### The Custom-Setting Approach (works for thousands of tenants)

This is the pattern LaunchDarkly uses in production for their Highlight observability backend. Instead of per-tenant users, you have a single shared user. Tenant identity is passed as a custom per-query setting, and a row policy reads it.

```sql
-- Create a role with one special property: the custom setting is
-- allowed to be changed even by a readonly user
CREATE ROLE analytics_readonly;
ALTER ROLE analytics_readonly SETTINGS SQL_tenant_id CHANGEABLE_IN_READONLY;
GRANT SELECT ON events TO analytics_readonly;

-- Single row policy reads the per-query setting
CREATE ROW POLICY tenant_isolation ON events
  FOR SELECT
  USING tenant_id = getSetting('SQL_tenant_id')::UInt32
  TO analytics_readonly;

-- One shared database user for the entire application
CREATE USER app_analytics IDENTIFIED BY 'strong_password'
  SETTINGS readonly = 1;
GRANT analytics_readonly TO app_analytics;
SET DEFAULT ROLE analytics_readonly TO app_analytics;
```

Your application sends the tenant as a per-connection setting before each query:

```typescript
// With the official @clickhouse/client
const client = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: 'app_analytics',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function queryForTenant(tenantId: number, sql: string) {
  return client.query({
    query: sql,
    clickhouse_settings: {
      SQL_tenant_id: tenantId.toString(),
    },
  });
}
```

Three properties make this the right model for SaaS:

**Fail-closed.** If your application code omits `SQL_tenant_id`, ClickHouse throws `Unknown setting 'SQL_tenant_id'` and the query fails. There is no path where a missing tenant context silently returns all tenants' data.

**Connection pooling works.** A single pool of connections against a single user can serve all tenants. The tenant identity is passed at the query level, not the connection level.

**O(1) policy management.** Adding tenant 10,001 requires no ClickHouse DDL at all, just an insert into your application's tenants table.

One important caveat: `CHANGEABLE_IN_READONLY` is required. Without it, a readonly user cannot change the custom setting and every query fails with a permissions error. Also note that `getSetting()` row policies do not drive primary key pruning on their own. The policy filter is applied after granule selection. Best practice is to include `WHERE tenant_id = ?` explicitly in your queries even though the row policy provides the correctness guarantee:

```sql
-- Correct pattern: redundant tenant filter drives the primary index scan,
-- while the row policy provides the safety net
SELECT
    event_type,
    count() AS total_events
FROM events
WHERE tenant_id = 42
  AND event_time >= now() - INTERVAL 7 DAY
GROUP BY event_type
ORDER BY total_events DESC;
```

---

## Wiring Tenant Context Through Your Application

The row policy above provides the database-level guarantee. You still need to get the tenant identity from the incoming request to the ClickHouse query. Here is the full path.

### Without an Abstraction Layer

```typescript
import { createClient } from '@clickhouse/client';
import jwt from 'jsonwebtoken';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: 'app_analytics',
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Next.js App Router route handler
export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return new Response('Unauthorized', { status: 401 });

  const payload = jwt.verify(token, process.env.JWT_SECRET!) as { tenantId: number };

  const result = await client.query({
    query: `
      SELECT event_type, count() AS total_events
      FROM events
      WHERE tenant_id = {tenantId:UInt32}
        AND event_time >= now() - INTERVAL 7 DAY
      GROUP BY event_type
      ORDER BY total_events DESC
    `,
    query_params: { tenantId: payload.tenantId },
    clickhouse_settings: {
      SQL_tenant_id: payload.tenantId.toString(),
    },
  });

  return Response.json(await result.json());
}
```

This is functional and ships the safety properties we want: a parameterized query prevents SQL injection, `clickhouse_settings` sets the row-policy guard, and both fail independently if compromised.

### With a Typed Query Layer

If you're defining many analytics endpoints across a TypeScript codebase, it is worth centralizing the tenant injection. [hypequery](https://github.com/hypequery/hypequery)'s serve API does this through a `context` callback on `initServe`. You extract the tenant once, and every query definition receives it automatically through the typed `ctx` object. In practice, this gives you **auto-injection of tenant context** at the application layer: route handlers do not need to thread `tenantId` manually through every function call, and individual query definitions do not need to re-parse auth state.

The difference is easiest to see side by side:

**Manual threading:**

```typescript
async function getEventCounts(tenantId: number, days: number) {
  return db
    .table('events')
    .select(['event_type'])
    .count('event_id', 'total_events')
    .where('tenant_id', 'eq', tenantId)
    .where('event_time', 'gte', `now() - INTERVAL ${days} DAY`)
    .groupBy(['event_type'])
    .settings({ SQL_tenant_id: tenantId })
    .execute();
}

export async function POST(req: Request) {
  const tenantId = await readTenantIdFromJwt(req);
  return Response.json(await getEventCounts(tenantId, 7));
}
```

**Auto-injection through request context:**

```typescript
const { query, serve } = initServe({
  context: ({ req }) => {
    const tenantId = readTenantIdFromJwt(req);
    return { db, tenantId };
  },
});

const eventCounts = query({
  input: z.object({ days: z.number().default(7) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events')
      .select(['event_type'])
      .count('event_id', 'total_events')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('event_time', 'gte', `now() - INTERVAL ${input.days} DAY`)
      .groupBy(['event_type'])
      .settings({ SQL_tenant_id: ctx.tenantId })
      .execute(),
});
```

Both are correct. The second scales better because the tenant value is injected once at the edge of the request and then flows through every query automatically. That reduces repetitive auth plumbing and makes missing tenant scope much easier to spot in review.

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: 'app_analytics',
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const { query, serve } = initServe({
  context: ({ req }) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) throw new Error('Unauthorized');

    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET!
    ) as { tenantId: number; userId: string };

    // Return a typed context available in every query
    return { db, tenantId: payload.tenantId, userId: payload.userId };
  },
});

const eventCounts = query({
  description: 'Event counts grouped by type for the last N days',
  input: z.object({ days: z.number().min(1).max(90).default(7) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events')
      .select(['event_type'])
      .count('event_id', 'total_events')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('event_time', 'gte', `now() - INTERVAL ${input.days} DAY`)
      .groupBy(['event_type'])
      .orderBy('total_events', 'DESC')
      .settings({ SQL_tenant_id: ctx.tenantId })
      .execute(),
});

const weeklyRevenue = query({
  description: 'Daily revenue totals for the last 30 days',
  input: z.object({}),
  query: ({ ctx }) =>
    ctx.db
      .table('orders')
      .select(['toDate(created_at) AS day'])
      .sum('amount', 'revenue')
      .where('tenant_id', 'eq', ctx.tenantId)
      .where('status', 'eq', 'completed')
      .groupBy(['day'])
      .orderBy('day', 'ASC')
      .settings({ SQL_tenant_id: ctx.tenantId })
      .execute(),
});

export const api = serve({ queries: { eventCounts, weeklyRevenue } });
```

The important property here is not just type safety. It is that tenant context is **auto-injected once per request** and then reused by every query definition behind that API surface. That makes the safe path the default path: developers write analytics queries against `ctx.tenantId`, and the request-scoped tenant value is already there instead of being passed manually from handler to handler.

Mount in Next.js App Router:

```typescript
// app/api/analytics/[[...slug]]/route.ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from '@/analytics/api';

const handler = createFetchHandler(api.handler);
export { handler as GET, handler as POST };
```

On the frontend, the same definitions drive typed React hooks:

```typescript
import { createHooks } from '@hypequery/react';
import type { api } from '@/analytics/api';

const { useQuery } = createHooks<typeof api>({ baseUrl: '/api/analytics' });

function EventCountsWidget() {
  const { data, loading } = useQuery('eventCounts', { days: 7 });

  if (loading) return <Skeleton />;
  return (
    <BarChart
      data={data}
      xKey="event_type"
      yKey="total_events"
    />
  );
}
```

The type safety runs end-to-end: if you rename a column in the ClickHouse schema and regenerate with `npx hypequery generate`, the TypeScript compiler flags every query that references the old name, across both your server query definitions and your React components. Just as importantly for multi-tenancy, tenant filtering is no longer a parameter-passing convention. It is an auto-injected request context that each query consumes consistently.

---

## Making Dashboards Feel Instant

Correctness is the prerequisite. Performance is what makes the feature worth having. Three layers of optimization, in order of impact:

### Aggregate Projections

Projections are one of the most underused ClickHouse features for dashboard workloads. A projection stores a precomputed aggregation inside the same parts as the base table. When a query matches its definition, ClickHouse rewrites the query to use the projection automatically, with no application changes and no separate table to query.

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

-- Materialize for existing data
ALTER TABLE events MATERIALIZE PROJECTION hourly_event_counts;
```

After this, dashboard queries aggregating hourly event counts are served from the projection rather than scanning the raw events. The speedup on large datasets is an order of magnitude. The 200M-row example goes from around 1.4s to around 12ms for hourly aggregations.

One caveat: tables with projections currently do not support lightweight `UPDATE`/`DELETE` operations. If your tenant offboarding workflow does row-level deletes, you'll need to drop and re-add projections around the mutation, or use the partition-drop approach instead.

### Incremental Materialized Views

For more complex pre-aggregations, such as different sort orders, joins at insert time, or separate TTLs per tenant tier, a materialized view with `AggregatingMergeTree` is the right tool:

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

Query via `countMerge()`:

```sql
SELECT
    event_type,
    countMerge(total_events) AS total_events
FROM events_hourly_agg
WHERE tenant_id = 42
  AND hour >= now() - INTERVAL 7 DAY
GROUP BY event_type
ORDER BY total_events DESC;
```

### Query Condition Cache (ClickHouse 25.3+)

Introduced in March 2025, the Query Condition Cache stores which granules satisfied a `WHERE` predicate in a previous query. On repeat executions of the same dashboard query shape, ClickHouse skips the predicate evaluation entirely for granules it already knows do not match.

For multi-tenant dashboards, where many tenants run the same query pattern against different `tenant_id` values, this is significant. The cache is hit after the first execution and repeat loads drop to sub-50ms even on queries that do not benefit from aggregate projections. Enable it with:

```sql
SET use_query_condition_cache = 1;
```

This is now the free performance layer you get before reaching for materialized views or projections. Instrument your top queries, check whether they are hitting the cache, then decide whether a projection is still worth the maintenance overhead.

### Result Caching and Deduplication

A single dashboard page typically fires 8 to 15 queries simultaneously. Without deduplication, each widget independently fires against ClickHouse. With SWR-style result caching, repeated queries within a short window, say 60 seconds, are served from memory, and concurrent identical queries are coalesced into one request.

Set `max_execution_time` per settings profile, covered below, to ensure no single slow query can block a dashboard load indefinitely.

---

## Resource Isolation and Noisy Neighbors

When tenants share a cluster, one tenant's expensive query can degrade latency for everyone else. ClickHouse has three independent layers to address this.

### Settings Profiles per Plan Tier

Assign a settings profile to each plan tier. New users inherit the profile for their plan:

```sql
CREATE SETTINGS PROFILE free_tier
  SETTINGS max_memory_usage = 1073741824,
           max_execution_time = 10,
           max_threads = 2,
           priority = 10;

CREATE SETTINGS PROFILE pro_tier
  SETTINGS max_memory_usage = 4294967296,
           max_execution_time = 60,
           max_threads = 8,
           priority = 5;

CREATE SETTINGS PROFILE enterprise_tier
  SETTINGS max_memory_usage = 17179869184,
           max_execution_time = 300,
           max_threads = 16,
           priority = 1;

ALTER USER app_analytics SETTINGS PROFILE 'pro_tier';
```

For multi-tier support where different tenants have different limits, the cleanest approach is one ClickHouse user per tier rather than one per tenant.

### Keyed Quotas for Per-Tenant Rate Limiting

ClickHouse quotas let you define usage limits per time window. The `keyed` mode is what matters for multi-tenancy: the `quota_key` is passed per query, and ClickHouse tracks usage separately for each distinct key value.

```sql
CREATE QUOTA tenant_quota
  KEYED BY 'quota_key'
  FOR INTERVAL 1 MINUTE MAX queries = 30,
  FOR INTERVAL 1 HOUR MAX queries = 500, read_rows = 10000000000,
                       result_rows = 1000000;

GRANT QUOTA tenant_quota TO analytics_readonly;
```

Pass the quota key per query:

```typescript
await client.query({
  query: sql,
  clickhouse_settings: {
    SQL_tenant_id: tenantId.toString(),
    quota_key: tenantId.toString(),
  },
});
```

Note: quota counters are in-memory and reset on server restart. For billing-grade enforcement, where you need durable per-tenant counts that survive restarts, supplement with application-layer limits. A Redis token bucket keyed on tenant ID is the common pattern. Quotas are best used as a protection layer, not as a billing source of truth.

### Query Cancellation

Dashboards generate abandoned queries when users navigate away. Without cleanup, these accumulate and compete for resources. Two mechanisms:

```sql
SET cancel_http_readonly_queries_on_client_close = 1;
```

For explicit cancellation, such as when a user clicks a stop button, the route changes, or a dashboard unmounts:

```typescript
const queryId = crypto.randomUUID();

const result = await client.query({
  query: sql,
  query_id: queryId,
  clickhouse_settings: { SQL_tenant_id: tenantId.toString() },
});

await client.command({ query: `KILL QUERY WHERE query_id = '${queryId}'` });
```

Set `max_execution_time` via the settings profile as the hard backstop. Even if the client does not cancel, ClickHouse will.

---

## Tenant Onboarding and Offboarding at Scale

### Onboarding

With the custom-setting row-policy model, adding a new tenant is just an application-level operation:

```sql
CREATE TABLE tenants
(
    tenant_id   UInt32,
    tenant_name String,
    plan        LowCardinality(String),
    created_at  DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY tenant_id;
```

```typescript
await appDb.query(
  'INSERT INTO tenants (tenant_id, tenant_name, plan) VALUES (?, ?, ?)',
  [newTenantId, tenantName, 'pro']
);
```

No ClickHouse DDL is required. The row policy handles isolation automatically.

### Offboarding and Data Deletion

Three options, depending on your schema and compliance requirements:

**Partition drop (fastest, only available if `tenant_id` is in `PARTITION BY`):**

```sql
ALTER TABLE events DROP PARTITION tuple(42, 202501);
```

**Lightweight delete (ClickHouse 23.3+, general-purpose):**

```sql
DELETE FROM events WHERE tenant_id = 42;
```

Lightweight deletes are asynchronous. They mark rows as deleted and the physical removal happens during background merges. They are the right default for most schemas. Note that they are currently incompatible with tables that have projections defined.

**Tombstone table (alternative, soft delete via MV filter):**

If you cannot modify the base table, a separate `tenant_deletions` table combined with a `WHERE tenant_id NOT IN (SELECT ...)` filter gives you a soft-delete layer that is easy to revert.

### Per-Tenant Observability

`system.query_log` is a goldmine for per-tenant usage analytics. Build a materialized view over it to track usage patterns, catch abusive queries, and drive billing:

```sql
CREATE MATERIALIZED VIEW tenant_query_stats
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(query_hour)
ORDER BY (tenant_id, query_hour)
AS
SELECT
    toUInt32(getSetting('SQL_tenant_id')) AS tenant_id,
    toStartOfHour(query_start_time) AS query_hour,
    count() AS query_count,
    sum(read_rows) AS rows_read,
    sum(memory_usage) AS memory_used,
    sum(query_duration_ms) AS total_duration_ms
FROM system.query_log
WHERE type = 'QueryFinish'
GROUP BY tenant_id, query_hour;
```

Query this for billing, abuse detection, and capacity planning without touching your application events table.

---

## ClickHouse Cloud vs Self-Hosted

Most of this guide applies equally to both. A few important differences:

**SharedMergeTree vs ReplicatedMergeTree.** Cloud uses SharedMergeTree, where storage lives in object storage and compute is stateless. Adding replicas is instant. On self-hosted, shard topology is set at table creation time and changing it requires data movement.

**Compute-compute separation (Warehouses).** Cloud-only. Multiple isolated compute services share the same underlying data. This is the cleanest way to offer dedicated compute to enterprise customers without duplicating your data lake, and without the full operational overhead of a separate ClickHouse service.

**Parallel replicas.** Now beta-stable in self-hosted 25.x, and likely GA soon in Cloud. A single large tenant's query can fan out across all nodes, which addresses the one-big-tenant-dominates-the-cluster problem elegantly.

**PostgreSQL CDC.** Cloud has a built-in managed CDC connector from PostgreSQL. If your tenant metadata lives in Postgres, which is common for SaaS, this is a clean path to syncing it into ClickHouse for analytics joins without building a custom pipeline.

**Refreshable materialized views.** Available in both. `REFRESH EVERY 1 HOUR` lets you build nightly or hourly per-tenant rollups on a schedule rather than relying on streaming MV triggers. This is useful for expensive aggregations where streaming MVs are disproportionate overhead.

---

## What Changed in 2025 That Affects This Architecture

The pace of ClickHouse development means advice from 2023 is sometimes wrong today. A few changes worth calling out explicitly:

**Query Condition Cache (25.3, March 2025):** covered above. Probably the biggest single win for dashboard workloads at no architectural cost.

**Lightweight updates:** `UPDATE column = expression WHERE ...` with patch-part semantics, roughly 2x faster than traditional mutations. Still incompatible with projections as of writing.

**Lazy materialization / lazy column reads:** ClickHouse now defers reading column data to the latest possible stage. This helps row-policy-filtered queries where late filtering was previously reading more data than necessary.

**Parallel replicas (beta-stable):** fan out a single query across replicas without manual query splitting. This changes the calculus for large-tenant isolation. A dedicated replica can serve one big tenant's queries without impacting others.

**`_part_offset` projections:** projections can now store just the sort key plus a pointer back to the base part. This is a cheaper way to maintain alternate sort orders for per-tenant access patterns when full projection materialization is too expensive.

---

## A Reference Architecture

Pulling everything together into one deployable pattern:

```text
Next.js App Router
  └── /api/analytics/[[...slug]]/route.ts
        └── createFetchHandler(api.handler)
              └── initServe({ context: JWT → tenantId })
                    └── query({ ... ctx.tenantId ... })
                          └── @hypequery/clickhouse
                                ├── .where('tenant_id', 'eq', ctx.tenantId)
                                └── .settings({ SQL_tenant_id: ctx.tenantId })

ClickHouse
  ├── events table: ORDER BY (tenant_id, event_time, event_id)
  ├── Aggregate projection: (tenant_id, hour, event_type) → COUNT
  ├── Row policy: tenant_id = getSetting('SQL_tenant_id')
  ├── Settings profile: max_memory_usage / max_threads / max_execution_time per tier
  └── Keyed quota: per-tenant query/row rate limits
```

The schema:

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
ORDER BY (tenant_id, event_time, event_id)
TTL event_time + INTERVAL 2 YEAR DELETE;

ALTER TABLE events ADD PROJECTION hourly_counts
(
  SELECT tenant_id, toStartOfHour(event_time) AS hour, event_type, count()
  GROUP BY tenant_id, hour, event_type
);
ALTER TABLE events MATERIALIZE PROJECTION hourly_counts;

CREATE ROLE analytics_readonly;
ALTER ROLE analytics_readonly SETTINGS SQL_tenant_id CHANGEABLE_IN_READONLY;
GRANT SELECT ON events TO analytics_readonly;

CREATE ROW POLICY tenant_isolation ON events
  FOR SELECT
  USING tenant_id = getSetting('SQL_tenant_id')::UInt32
  TO analytics_readonly;

CREATE USER app_analytics IDENTIFIED BY '<strong-password>'
  SETTINGS readonly = 1;
GRANT analytics_readonly TO app_analytics;
SET DEFAULT ROLE analytics_readonly TO app_analytics;

CREATE QUOTA tenant_quota KEYED BY 'quota_key'
  FOR INTERVAL 1 MINUTE MAX queries = 30,
  FOR INTERVAL 1 HOUR MAX queries = 500, read_rows = 10000000000;
GRANT QUOTA tenant_quota TO analytics_readonly;
```

---

## Common Mistakes

**Putting `tenant_id` after time in the sort key.** `ORDER BY (event_time, tenant_id)` means every tenant query scans a time range across all tenants before filtering. It can be 100x slower than `ORDER BY (tenant_id, event_time)`.

**Partitioning by tenant at scale.** Fine for dozens of tenants, a parts-count problem at thousands.

**Omitting the redundant `WHERE tenant_id = ?`.** The row policy provides correctness, but not pruning. Without the explicit filter, ClickHouse still scans all granules and filters at the row-policy stage.

**Forgetting `CHANGEABLE_IN_READONLY` on the role.** Every query fails with a permissions error. Test this explicitly in your integration tests.

**Tiny inserts.** ClickHouse is optimized for batch writes. Sending individual events via `INSERT` produces too many parts and slows background merges. Buffer through Kafka, a Buffer engine table, or batch at the application layer. Aim for inserts of at least thousands of rows at a time.

**Join-heavy schemas.** ClickHouse performs best when the schema is designed for analytics from the start. If you're normalizing heavily, for example `events -> sessions -> users -> accounts`, you'll pay for every join. Denormalize common join attributes into the events table and use joins only where the alternative is unacceptable duplication.

**Stale advice on mutations.** Many posts still recommend `ALTER TABLE ... DELETE WHERE` heavy mutations. Lightweight deletes with `DELETE FROM ... WHERE` are now the right default for row-level removals in ClickHouse 23.3+.

---

## Closing

The technical foundation for multi-tenant embedded analytics on ClickHouse is more stable than it was two years ago. Row policies with `getSetting()` solve the isolation problem at scale in a way that actually works with connection pooling. Aggregate projections and the Query Condition Cache have made sub-100ms dashboard loads achievable without elaborate caching infrastructure. And ClickHouse's quota system, when used with `quota_key`, gives you real per-tenant rate limiting at the database layer.

The pattern that holds across PostHog, Grafana Cloud, LaunchDarkly, and other teams that have made this work at scale is consistent: shared tables, `tenant_id` first in the sort key, one row policy driven by a custom setting, and a typed query layer in the application that enforces the tenant context so it can never be accidentally omitted.

Get those four things right from the start and the rest is optimization.
