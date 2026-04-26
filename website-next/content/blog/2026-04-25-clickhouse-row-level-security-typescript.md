---
title: "How to Implement Row-Level Security in ClickHouse with TypeScript"
description: "ClickHouse has no native RLS like Postgres. Here are the three patterns for tenant isolation — and why context injection with hypequery is the right default for TypeScript teams."
seoTitle: "ClickHouse Row-Level Security TypeScript — Tenant Isolation Patterns"
seoDescription: "ClickHouse does not have native RLS like Postgres. Learn the three patterns for tenant isolation in ClickHouse with TypeScript — column filtering, user profiles, and context injection."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-row-level-security-typescript
status: published
---

If you're building a multi-tenant analytics system on ClickHouse and you're looking for row-level security (RLS) like Postgres's `CREATE POLICY`, you'll be disappointed: ClickHouse's approach is different. But the alternatives are solid — especially when you have a typed TypeScript layer to work with.

This post covers three patterns, from simplest to most robust.

## Pattern 1: Column Filtering — Add tenant_id Everywhere

The simplest approach: add a `tenant_id` column to every table and include a WHERE clause on every query.

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type String,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

```typescript
// Every query manually includes the tenant filter
async function getEvents(tenantId: number, startDate: string) {
  return db
    .table('events')
    .select('user_id', 'event_type', 'created_at')
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', startDate)
    .execute();
}
```

This works. ClickHouse is actually well-suited to this pattern because `tenant_id` can be the first column in the sort key, which means the primary key skip index eliminates most granules that don't belong to the tenant — making tenant-scoped queries very fast.

The problem is **discipline**: every developer writing a query must remember to add the tenant filter. One forgotten WHERE clause leaks another tenant's data. At scale, with many developers and many query functions, this becomes a liability.

## Pattern 2: ClickHouse User Profiles and Row Policies

ClickHouse has a row policy feature that enforces filters at the database level, regardless of what SQL is sent:

```sql
-- Create a row policy that restricts reads to matching tenant_id
CREATE ROW POLICY tenant_42_policy ON events
  FOR SELECT USING tenant_id = 42
  TO tenant_42_user;

-- Create the corresponding database user
CREATE USER tenant_42_user IDENTIFIED BY 'password';
GRANT SELECT ON events TO tenant_42_user;
```

With this in place, even a `SELECT * FROM events` run as `tenant_42_user` only returns rows where `tenant_id = 42`. The enforcement is at the database level, not the application level.

Connecting with a tenant-scoped user in hypequery:

```typescript
function createTenantDb(tenantId: number) {
  return createQueryBuilder<Schema>({
    host: process.env.CLICKHOUSE_HOST!,
    username: `tenant_${tenantId}_user`,
    password: getTenantDbPassword(tenantId),
  });
}
```

The security guarantee is strong — even a malicious or buggy query can't see other tenants' data because the database enforces the restriction.

The tradeoff: managing one database user per tenant is operationally complex. You need to provision users on tenant creation, rotate passwords, and handle the lifecycle. For systems with hundreds or thousands of tenants this becomes a significant maintenance burden.

## Pattern 3: Context Injection with hypequery/serve (Recommended)

The recommended approach for TypeScript teams using hypequery is context injection. The idea: inject the authenticated tenant's ID at the request context level so it's automatically available to every query without per-query boilerplate.

This makes tenant scoping part of the standard query path rather than a convention that each developer must follow.

### Setting Up Context Injection

```typescript
// server/index.ts
import { initServe, serve } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './db';

// Context is built from the incoming request — verify the JWT and extract tenantId
const { query } = initServe({
  context: (req) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('Unauthorized');

    const payload = verifyJwt(token);  // Your JWT verification logic
    return {
      db,
      tenantId: payload.tenantId as number,
    };
  },
});
```

### Using Context in Queries

Every query handler receives the context with `tenantId` already verified and typed:

```typescript
const eventQueries = {
  dailyCounts: query({
    input: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
    query: async ({ ctx, input }) => {
      // ctx.tenantId is always present — no need to pass it as a parameter
      return ctx.db
        .table('events')
        .select('toDate(created_at) as date', 'count() as cnt')
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('created_at', 'gte', input.startDate)
        .where('created_at', 'lte', input.endDate)
        .groupBy('date')
        .orderBy('date', 'ASC')
        .execute();
    },
  }),

  topPages: query({
    input: z.object({ date: z.string() }),
    query: async ({ ctx, input }) => {
      return ctx.db
        .table('events')
        .select('page_path', 'count() as views')
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('event_type', 'eq', 'page_view')
        .where('toDate(created_at)', 'eq', input.date)
        .groupBy('page_path')
        .orderBy('views', 'DESC')
        .limit(10)
        .execute();
    },
  }),

  userActivity: query({
    input: z.object({ userId: z.string() }),
    query: async ({ ctx, input }) => {
      return ctx.db
        .table('events')
        .select('event_type', 'count() as cnt')
        .where('tenant_id', 'eq', ctx.tenantId)
        // Note: no way to accidentally query a different tenant's user
        .where('user_id', 'eq', input.userId)
        .groupBy('event_type')
        .execute();
    },
  }),
};

serve({ queries: eventQueries, port: 3001 });
```

### Why This Is Better Than Per-Query Filtering

- **You can't forget it.** The context type requires `tenantId`. If you write a query that doesn't use `ctx.tenantId`, TypeScript won't error — but code review has a clear pattern to check for.
- **No tenant ID in request inputs.** Callers can't pass a different `tenantId` in the request body to access another tenant's data. The tenant comes from the verified JWT, not user-supplied input.
- **Centralized audit point.** All tenant verification logic is in one place — the `context` function in `initServe`. Change auth logic there and it applies everywhere.

### Adding a Helper to Enforce the Pattern

If you want to make the tenant filter part of the default query path, wrap the query builder:

```typescript
// lib/tenant-db.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

export function createDb() {
  return createQueryBuilder<Schema>({ host: process.env.CLICKHOUSE_HOST! });
}

type DB = ReturnType<typeof createDb>;

export function createTenantScopedQuery(db: DB, tenantId: number) {
  return {
    events: () =>
      db.table('events').where('tenant_id', 'eq', tenantId),
    pageViews: () =>
      db.table('page_views').where('tenant_id', 'eq', tenantId),
  };
}
```

```typescript
// In your query handler
query: async ({ ctx, input }) => {
  const tenantDb = createTenantScopedQuery(ctx.db, ctx.tenantId);

  // Can't forget the tenant filter — it's already applied
  return tenantDb.events()
    .select('event_type', 'count() as cnt')
    .where('toDate(created_at)', 'eq', input.date)
    .groupBy('event_type')
    .execute();
},
```

## Choosing the Right Pattern

| Pattern | Enforcement | Operational complexity | Best for |
|---|---|---|---|
| Column filtering | Developer discipline | Low | Small teams, prototypes |
| ClickHouse user profiles | Database-enforced | High | Compliance requirements, external access |
| Context injection | Structural (code review) | Low | TypeScript teams using @hypequery/serve |

For most TypeScript applications using hypequery, context injection is the right default. It's low overhead, fits naturally into the `@hypequery/serve` architecture, and makes the tenant isolation pattern explicit and reviewable without the operational cost of per-tenant database users.
