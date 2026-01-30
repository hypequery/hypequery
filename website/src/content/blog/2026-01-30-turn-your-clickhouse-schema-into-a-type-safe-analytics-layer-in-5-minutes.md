---
title: "Turn Your ClickHouse Schema Into a Type-Safe Analytics Layer in 5 Minutes"
description: "Go from raw SQL strings to a fully typed SDK + HTTP API + React hooks in about 5 minutes. Learn how to auto-generate TypeScript types from your ClickHouse schema and never worry about schema drift again."
pubDate: 2026-01-30
heroImage: ""
---

ClickHouse is fast. Your developer experience with it? Not so much.

```typescript
// The old way: Raw SQL strings in TypeScript
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

**Here's the new way:**

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST,
  username: 'default',
  password: '',
  database: 'analytics'
});

const powerUsers = await db
  .table('sessions')
  .select(['user_id', { session_count: 'COUNT(*)' }])
  .where('created_at', 'gte', 'now() - INTERVAL 7 DAY')
  .groupBy('user_id')
  .having('session_count', 'gt', 5)
  .execute();

// TypeScript knows the exact shape:
// { user_id: string; session_count: number }[]
```

Full autocomplete. Compile-time type checking. Refactor-friendly.

What makes this possible is a **schema-driven analytics layer**—and it takes 30 seconds to set up with ClickHouse.

In this post, you'll go from a plain ClickHouse schema to a schema-driven analytics layer—typed SDK + HTTP API + React hooks—in about 5 minutes.

---

## Step 1: Point hypequery at Your ClickHouse (30 seconds)

Run one command:

```bash
npx @hypequery/cli init
```

The CLI prompts for your connection details:

```bash
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
- ✅ Full TypeScript SDK for your ClickHouse schema
- ✅ Example query already set up
- ✅ Serve layer (the built-in HTTP server) pre-configured and ready to run
- ✅ Type-safe API endpoints

---

## Step 2: Start Your Dev Server (Instant HTTP API)

The CLI already generated a serve setup in `analytics/queries.ts`. Open it and you'll see:

```typescript
import { initServe } from '@hypequery/serve';
import { db } from './client';

const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    // Example query using your 'sessions' table
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

**Start the server:**

```bash
npx @hypequery/cli dev
```

That's it. You now have:
- **HTTP endpoint**: `http://localhost:4000/sessionsQuery`
- **Interactive docs**: `http://localhost:4000/docs` (try it!)
- **OpenAPI spec**: `http://localhost:4000/openapi.json`

Add more queries to `queries.ts` and they automatically become HTTP endpoints with zero additional code.

---

## Step 3: Your Schema Becomes a TypeScript SDK (Auto-Generated)

Open `analytics/schema.ts`. You'll see perfectly-typed interfaces for every table:

> **Note:** This file is generated. You don't edit it by hand; just rerun `npx @hypequery/cli generate` when your schema changes.

```typescript
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

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL,
});
```

You're ready. Type `db.` and your IDE shows all 47 tables. Pick one, and you see every column—fully typed and ready for autocomplete.

---

## Step 4: Real Queries, Real Types

### Simple query with full autocomplete

```typescript
const recentSessions = await db
  .table('sessions')  // ← Autocomplete suggests all 47 tables
  .select(['user_id', 'session_id', 'created_at'])
  .where('created_at', 'gte', 'now() - INTERVAL 1 DAY')
  .orderBy('created_at', 'DESC')
  .limit(100)
  .execute();

// TypeScript infers:
// { user_id: string; session_id: string; created_at: DateTime<string> }[]
```

> **Note:** We're passing `'now() - INTERVAL 1 DAY'` as a string—hypequery doesn't hide SQL from you, it just types your schema and builder. You can also use bound parameters for dynamic values.

**What you get:**
- ✅ Autocomplete for table names
- ✅ Autocomplete for column names within each table
- ✅ Compile-time checking that `created_at` actually exists
- ✅ Full type inference for the result

### Joins with type safety

```typescript
const topProducts = await db
  .table('orders')
  .innerJoin('products', 'orders.product_id', 'products.id')
  .select([
    'products.name as product_name',
    { total_revenue: 'SUM(orders.amount)' },
    { order_count: 'COUNT(orders.id)' }
  ])
  .where('orders.created_at', 'gte', '2025-01-01')
  .groupBy('products.id')
  .orderBy('total_revenue', 'DESC')
  .limit(10)
  .execute();

// Type knows:
// { product_name: string; total_revenue: string; order_count: string }[]
```

### Complex aggregations

```typescript
const dailyStats = await db
  .table('sessions')
  .select([
    { date: 'toDate(created_at)' },
    { total_users: 'COUNT(DISTINCT user_id)' },
    { total_sessions: 'COUNT(*)' },
    { avg_duration: 'AVG(duration_ms)' }
  ])
  .where('created_at', 'between', ['2025-01-01', '2025-01-31'])
  .groupBy('date')
  .orderBy('date', 'ASC')
  .execute();
```

### Errors caught at compile time

```typescript
// ❌ Typo in column name
const result = await db
  .table('sessions')
  .select(['user_id', 'creatd_at'])  // ← TypeScript error
  .execute();

// Error: Argument of type '"creatd_at"' is not assignable to
// parameter of type '"user_id" | "session_id" | "created_at" | ...'

// ❌ Wrong table
await db.table('sessons')  // ← TypeScript error

// Error: Argument of type '"sessons"' is not assignable to
// parameter of type '"sessions" | "events" | "orders" | ...'
```

No more runtime surprises. Your IDE tells you exactly what's wrong before you even run the code.

---

## Step 5: Schema Changes? Regenerate in One Command

Here's where schema-driven SDKs shine: your schema evolves, and your types stay in sync automatically.

### Scenario: Add a column to ClickHouse

```sql
-- In ClickHouse, run:
ALTER TABLE sessions ADD COLUMN campaign_source String;
```

```bash
# Regenerate your types:
npx @hypequery/cli generate

# ✓ Fetched schema from ClickHouse
# ✓ Updated analytics/schema.ts (added campaign_source to Sessions interface)
```

```typescript
// The new column is immediately available:
const sessionsByCampaign = await db
  .table('sessions')
  .select(['campaign_source', { count: 'COUNT(*)' }])
  .where('campaign_source', 'eq', 'email')
  .groupBy('campaign_source')
  .execute();
```

### Scenario: Rename a column

```sql
-- Rename device_type → device
ALTER TABLE sessions RENAME COLUMN device_type TO device;
```

```bash
# Regenerate:
npx @hypequery/cli generate

# Your interface now has `device` instead of `device_type`
```

```typescript
// This now fails at compile time:
await db
  .table('sessions')
  .where('device_type', 'eq', 'mobile')  // ← TypeScript error
  .execute();

// Error: '"device_type"' does not exist in type...

// Fix it everywhere with find-and-replace:
await db
  .table('sessions')
  .where('device', 'eq', 'mobile')  // ← ✅ Works
  .execute();
```

TypeScript tells you every query that broke. Fix them all with confidence, then deploy.

---

## Step 6: Add More Queries (They're Instantly Available as APIs)

Remember that `analytics/queries.ts` file the CLI generated? Just add more queries to it:

```typescript
// analytics/queries.ts
export const api = define({
  queries: queries({
    // Your existing sessionsQuery...

    // Add a new query
    powerUsers: query
      .describe('Get users with >N sessions in date range')
      .input(z.object({
        days: z.number().default(7),
        minSessions: z.number().default(5)
      }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('sessions')
          .select(['user_id', { session_count: 'COUNT(*)' }])
          .where('created_at', 'gte', `now() - INTERVAL ${input.days} DAY`)
          .groupBy('user_id')
          .having('session_count', 'gt', input.minSessions)
          .execute()
      ),

    // Add another
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
          .select([
            'products.name',
            { total: 'SUM(orders.amount)' }
          ])
          .where('orders.created_at', 'between', [input.startDate, input.endDate])
          .groupBy('products.id')
          .execute()
      ),
  }),
});
```

Save the file. Your dev server auto-reloads. Boom:
- `http://localhost:4000/powerUsers?days=7&minSessions=5`
- `http://localhost:4000/revenueByProduct?startDate=2025-01-01&endDate=2025-01-31`
- All at `/docs` with interactive Swagger UI

**Same query works everywhere:**

```typescript
// 1. Execute directly (backend job)
const users = await api.execute('powerUsers', { days: 7 });

// 2. HTTP endpoint (API)
// GET http://localhost:4000/powerUsers?days=7

// 3. React hook (dashboard)
const { data } = useQuery('powerUsers', { days: 7 });
```

For the React dashboard, create hooks in a few lines:

```typescript
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { ApiDefinition } from '@/analytics/queries';

export const { useQuery, useMutation } = createHooks<ApiDefinition>({
  baseUrl: 'http://localhost:4000'
});

// ApiDefinition is inferred from your queries.ts definition
```

```typescript
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
        {data.map(user => (
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

**Learn more:**
- 📚 [Full documentation](https://hypequery.com/docs)
- 💻 [Examples](https://github.com/hypequery/hypequery-examples)
- 🐛 [Issues](https://github.com/hypequery/hypequery/issues)

---

*PS. This pattern—schema introspection → code generation → type-safe query builder → multi-platform execution—is what we call a **schema-driven analytics layer**. It brings the type-safety and developer experience of tools like Prisma, but optimized for analytics workloads with ClickHouse.*
