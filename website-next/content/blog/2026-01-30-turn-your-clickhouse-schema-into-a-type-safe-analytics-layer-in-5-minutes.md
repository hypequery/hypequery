---
title: "Turn Your ClickHouse Schema Into a Type-Safe Analytics Layer in 5 Minutes"
description: "Go from raw SQL strings to a fully typed SDK + HTTP API + React hooks in about 5 minutes. Learn how to auto-generate TypeScript types from your ClickHouse schema and never worry about schema drift again."
pubDate: 2026-01-30
heroImage: "ClickHouse is fast. Your developer experience with it? Not so much."
---

ClickHouse is fast. Your developer experience with it? Not so much.

## The old way: Raw SQL strings in TypeScript

```ts
const result = await client.query({
  query: `
    SELECT user_id, COUNT(*) as session_count
    FROM sessions
    WHERE created_at >= now() - INTERVAL 7 DAY
    GROUP BY user_id
    HAVING session_count > 5
  `
});

// What's the type of `result`?
// Did I spell `created_at` right?
// Is `session_count` a string or number?
// → You only find out at runtime 😬
```

No autocomplete. No type safety. Refactors are a game of find-and-replace across string literals. Errors show up in production, not at compile time.

Here's the new way:

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    powerUsers: query
      .describe('Get users with >N sessions in date range')
      .input(z.object({
        since: z.coerce.date(),
        minSessions: z.number().default(5),
      }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('sessions')
          .select(['user_id'])
          .count('session_id', 'session_count')
          .where('created_at', 'gte', input.since)
          .groupBy(['user_id'])
          .having('session_count > ?', [input.minSessions])
          .execute()
      ),
  }),
});

const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const powerUsers = await api.execute('powerUsers', {
  since,
  minSessions: 5,
});

// TypeScript knows the exact shape:
// { user_id: string; session_count: number }[]
```

Full autocomplete. Compile-time type checking. Refactor-friendly.

What makes this possible is a schema-driven analytics layer, and it takes about 30 seconds to set up with ClickHouse.

In this post, you'll go from a plain ClickHouse schema to a schema-driven analytics layer (typed SDK + HTTP API + React hooks) in about 5 minutes.

## Step 1: Point hypequery at your ClickHouse (30 seconds)

Run one command:

```bash
npx @hypequery/cli init
```

The CLI prompts for your connection details:

```text
✓ ClickHouse connection URL [clickhouse://localhost:8123/analytics]:
✓ Output directory [analytics/]:
✓ Connecting to ClickHouse...
✓ Found 47 tables
✓ Generating TypeScript types from your schema...
✓ Created analytics/schema.ts (200+ lines)
✓ Created analytics/client.ts
✓ Created analytics/queries.ts (with example API setup)
✓ Created .env with connection details
```

That's it. You now have:

- Full TypeScript SDK for your ClickHouse schema
- Example query already set up
- Serve layer (the built-in HTTP server) pre-configured and ready to run
- Type-safe API endpoints

## Step 2: Start Your Dev Server (Instant HTTP API)

The CLI already generated a server setup in `analytics/queries.ts`:

```ts
import { initServe } from '@hypequery/serve';
import { db } from './client';

const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    sessionsQuery: query
      .describe('Example query using the sessions table')
      .query(async ({ ctx }) =>
        ctx.db
          .table('sessions')
          .select('*')
          .limit(10)
          .execute()
      ),
  }),
});
```

Start the server:

```bash
npx @hypequery/cli dev
```

That's it. You now have:

- HTTP endpoint: `http://localhost:4000/sessionsQuery`
- Interactive docs: `http://localhost:4000/docs` (try it)
- OpenAPI spec: `http://localhost:4000/openapi.json`

Add more queries to `queries.ts` and they automatically become HTTP endpoints with zero additional code.

## Step 3: Your Schema Becomes a TypeScript SDK (Auto-Generated)

Open `analytics/schema.ts`. You'll see typed interfaces for every table.

Note: This file is generated. You don't edit it by hand; rerun `npx @hypequery/cli generate` when your schema changes.

```ts
// Auto-generated from your ClickHouse schema
export interface Sessions {
  user_id: string;
  session_id: string;
  created_at: DateTime<string>;
  duration_ms: number;
  page_views: number;
  device_type: string;
  referrer: string | null;
  // ... 50 more columns, all typed
}

export interface Events {
  event_id: string;
  session_id: string;
  event_name: string;
  properties: Map<string, string>;
  timestamp: DateTime<string>;
  // ... 30 more columns
}

export interface Orders {
  order_id: string;
  user_id: string;
  product_id: string;
  amount: number;
  created_at: DateTime<string>;
  status: string;
  // ... more columns
}

// All 47 tables, with every column typed correctly
```

Open `analytics/client.ts`:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL,
});
```

You're ready. Type `db.` and your IDE shows all 47 tables. Pick one and you get every column with autocomplete.

## Step 4: Real Queries, Real Types

### Simple query with full autocomplete

```ts
export const api = define({
  queries: queries({
    recentSessions: query
      .input(z.object({
        since: z.coerce.date(),
        limit: z.number().default(100),
      }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('sessions')
          .select(['user_id', 'session_id', 'created_at'])
          .where('created_at', 'gte', input.since)
          .orderBy('created_at', 'DESC')
          .limit(input.limit)
          .execute()
      ),
  }),
});

const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
const recentSessions = await api.execute('recentSessions', {
  since: oneDayAgo,
  limit: 100,
});

// TypeScript infers:
// { user_id: string; session_id: string; created_at: DateTime<string> }[]
```

Note: Here we're passing a typed `Date` boundary. You can still use SQL expressions when needed, but this pattern keeps filters strongly typed end-to-end.

What you get:

- Autocomplete for table names
- Autocomplete for column names within each table
- Compile-time checking that `created_at` exists
- Full type inference for the result

### Joins with type safety

```ts
const topProducts = await ctx.db
  .table('orders')
  .innerJoin('products', 'orders.product_id', 'products.id')
  .select([
    'products.name AS product_name',
  ])
  .sum('orders.amount', 'total_revenue')
  .count('orders.id', 'order_count')
  .where('orders.created_at', 'gte', '2025-01-01')
  .groupBy(['products.id', 'product_name'])
  .orderBy('total_revenue', 'DESC')
  .limit(10)
  .execute();

// Example inferred shape:
// { product_name: string; total_revenue: number; order_count: number }[]
```

### Complex aggregations

```ts
import { rawAs, selectExpr } from '@hypequery/clickhouse';

const dailyStats = await ctx.db
  .table('sessions')
  .select([
    selectExpr('toDate(created_at)', 'date'),
    rawAs<number, 'total_users'>('COUNT(DISTINCT user_id)', 'total_users'),
    rawAs<number, 'total_sessions'>('COUNT(*)', 'total_sessions'),
    rawAs<number, 'avg_duration'>('AVG(duration_ms)', 'avg_duration'),
  ])
  .where('created_at', 'between', ['2025-01-01', '2025-01-31'])
  .groupBy(['date'])
  .orderBy('date', 'ASC')
  .execute();
```

### Errors caught at compile time

```ts
// Typo in column name
const result = await ctx.db
  .table('sessions')
  .select(['user_id', 'creatd_at']) // TypeScript error
  .execute();

// Wrong table
await ctx.db.table('sessons') // TypeScript error
```

No more runtime surprises. Your IDE tells you what's wrong before you run the code.

## Step 5: Schema Regenerate in One Command

Here's where schema-driven SDKs shine: your schema evolves, and your types stay in sync automatically.

### Scenario: Add a column to ClickHouse

```sql
ALTER TABLE sessions ADD COLUMN campaign_source String;
```

```bash
npx @hypequery/cli generate
```

```text
✓ Fetched schema from ClickHouse
✓ Updated analytics/schema.ts (added campaign_source to Sessions interface)
```

```ts
const sessionsByCampaign = await ctx.db
  .table('sessions')
  .select(['campaign_source'])
  .count('session_id', 'count')
  .where('campaign_source', 'eq', 'email')
  .groupBy(['campaign_source'])
  .execute();
```

### Scenario: Rename a column

```sql
ALTER TABLE sessions RENAME COLUMN device_type TO device;
```

```bash
npx @hypequery/cli generate
```

Your interface now has `device` instead of `device_type`.

```ts
// This fails at compile time:
await ctx.db
  .table('sessions')
  .where('device_type', 'eq', 'mobile') // TypeScript error
  .execute();

// Fix:
await ctx.db
  .table('sessions')
  .where('device', 'eq', 'mobile')
  .execute();
```

TypeScript tells you every query that broke. Fix them with confidence, then deploy.

## Step 6: Add More Queries (Instant API Endpoints)

Add new queries to `analytics/queries.ts`:

```ts
export const api = define({
  queries: queries({
    powerUsers: query
      .describe('Get users with >N sessions in date range')
      .input(z.object({
        since: z.coerce.date(),
        minSessions: z.number().default(5)
      }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('sessions')
          .select(['user_id'])
          .count('session_id', 'session_count')
          .where('created_at', 'gte', input.since)
          .groupBy(['user_id'])
          .having('session_count > ?', [input.minSessions])
          .execute()
      ),

    revenueByProduct: query
      .describe('Get revenue grouped by product')
      .input(z.object({
        startDate: z.string(),
        endDate: z.string()
      }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('orders')
          .innerJoin('products', 'orders.product_id', 'products.id')
          .select(['products.name'])
          .sum('orders.amount', 'total')
          .where('orders.created_at', 'between', [input.startDate, input.endDate])
          .groupBy(['products.id', 'products.name'])
          .execute()
      ),
  }),
});
```

Save the file and the dev server auto-reloads.

```text
http://localhost:4000/powerUsers?since=2025-01-01T00:00:00.000Z&minSessions=5
http://localhost:4000/revenueByProduct?startDate=2025-01-01&endDate=2025-01-31
```

Everything is available at `/docs` with interactive Swagger UI.

Same query works everywhere:

```ts
// 1. Execute directly (backend job)
const users = await api.execute('powerUsers', {
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  minSessions: 5,
});

// 2. HTTP endpoint
// GET http://localhost:4000/powerUsers?since=2025-01-01T00:00:00.000Z&minSessions=5

// 3. React hook
const { data } = useQuery('powerUsers', {
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  minSessions: 5,
});
```

For the React dashboard, create hooks in a few lines:

```ts
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { ApiDefinition } from '@/analytics/queries';

export const { useQuery, useMutation } = createHooks<ApiDefinition>({});

// app/components/PowerUsers.tsx
function PowerUsersDashboard() {
  const { data, isLoading, error } = useQuery('powerUsers', {
    days: 7,
    minSessions: 5
  });

  // Fully typed: data is { user_id: string; session_count: number }[]

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <table>
      <thead>
        <tr>
          <th>User ID</th>
          <th>Sessions</th>
        </tr>
      </thead>
      <tbody>
        {data.map((user) => (
          <tr key={user.user_id}>
            <td>{user.user_id}</td>
            <td>{user.session_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Get Started in 30 Seconds

```bash
npx @hypequery/cli init
```

You'll have a full TypeScript SDK for your ClickHouse database before your coffee gets cold.
