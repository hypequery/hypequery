---
title: "How to Build a ClickHouse Dashboard with React and Next.js"
description: "Build ClickHouse dashboards in React and Next.js: generated types, server components for internal pages, a typed API for interactive panels, polling hooks for live data, and a real-time leaderboard with LIMIT BY."
seoTitle: "ClickHouse Dashboard with React and Next.js"
seoDescription: "Build a ClickHouse dashboard in React and Next.js: typed queries, server components, polling hooks for live data, and a real-time leaderboard."
pubDate: 2025-07-22
updated: 2026-11-08
heroImage: ""
slug: building-dashboards-clickhouse-hypequery-nextjs
status: published
---

To build a ClickHouse dashboard in React and Next.js, keep every query on the server. Generate TypeScript types from your ClickHouse schema, write queries with a typed builder, render read-only pages from server components, and put interactive panels behind one typed API that React hooks call. For live data, poll: ClickHouse aggregates fast enough that a 5 to 30 second `refetchInterval` feels real-time without WebSockets or a streaming pipeline.

This guide builds that stack with [hypequery](https://github.com/hypequery/hypequery), from a one-page internal tool to a live leaderboard. Every SQL statement and builder query here was run against ClickHouse 26.6. For the architecture-level view, see the [ClickHouse dashboard](/clickhouse-dashboard) and [ClickHouse React](/clickhouse-react) guides.

## Quick answers

### Can React query ClickHouse directly?

It shouldn't. A browser that can reach ClickHouse holds database credentials and can run any SQL. Query from server components or an API route, and send the browser only results.

### Server components or an API route?

Server components for read-only pages: the query runs at request time on the server, with no endpoint to secure. Add an API route when a panel needs client-side interaction, such as a date picker or polling.

### How do I make a ClickHouse dashboard real-time?

Poll. Pass `refetchInterval: 5_000` to the query hook and TanStack Query refetches every five seconds, pausing while the tab is in the background. Reach for streaming only if you need sub-second updates.

### How do I build a leaderboard in ClickHouse?

`sum(points) ... GROUP BY player_id ORDER BY total DESC LIMIT 10` over raw score events. For a top 10 per region in one query, use ClickHouse's `LIMIT 10 BY region`. See [the leaderboard section](#a-real-time-leaderboard).

---

## Step 1: Generate types from your schema

The examples use three tables: orders for a revenue page, events for a usage panel, and score events for a leaderboard.

```sql
CREATE TABLE orders (
  id String,
  customer_id String,
  status LowCardinality(String),
  total Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY created_at;

CREATE TABLE events (
  user_id String,
  event_type LowCardinality(String),
  page_path String,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (event_type, created_at);

CREATE TABLE score_events (
  player_id String,
  region LowCardinality(String),
  points UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at, player_id);
```

Install the packages and generate types:

```bash
npm install @hypequery/clickhouse @hypequery/serve @hypequery/react @tanstack/react-query zod
npm install -D @hypequery/cli
npx hypequery generate
```

`hypequery generate` reads the `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD` environment variables and writes `analytics/schema.ts`. Re-run it when the schema changes; the compiler then lists every query and component that broke.

Create the client once, in a module only server code imports:

```ts
// analytics/client.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});
```

## Step 2: Write the dashboard queries

```ts
// analytics/queries.ts
import { selectExpr } from '@hypequery/clickhouse';
import { db } from './client';

export function revenueByDay(from: string, to: string) {
  return db
    .table('orders')
    .select([selectExpr('toStartOfDay(created_at)', 'day')])
    .sum('total', 'revenue')
    .count('id', 'order_count')
    .where('status', 'eq', 'completed')
    .where('created_at', 'between', [from, to])
    .groupBy(['day'])
    .orderBy('day', 'ASC')
    .execute();
}

export function topCustomers(from: string) {
  return db
    .table('orders')
    .select(['customer_id'])
    .sum('total', 'revenue')
    .where('status', 'eq', 'completed')
    .where('created_at', 'gte', from)
    .groupBy('customer_id')
    .orderBy('revenue', 'DESC')
    .limit(10)
    .execute();
}
```

Table names, columns and filter values are checked against the generated schema, so a typo like `'customer_ids'` fails the build. Values are sent as bound parameters, not pasted into the SQL string.

**Convert numbers at the display layer.** The builder types every aggregate as `string`. That is exactly right for `count()`, which returns a `UInt64` that hypequery receives as a string. A `sum()` of a `Float64` column arrives as a JSON number. `Number(row.revenue)` handles both, so call it where you render, not in the query. `DateTime` values such as `day` arrive as `"2026-11-08 00:00:00"` strings.

## Step 3: A read-only page is just a server component

For an internal page, call the queries directly from a server component. ClickHouse credentials never leave the server, and there is no endpoint to secure beyond your existing app auth.

```tsx
// app/analytics/page.tsx
import { revenueByDay, topCustomers } from '@/analytics/queries';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const [daily, customers] = await Promise.all([
    revenueByDay('2026-10-01 00:00:00', '2026-10-31 23:59:59'),
    topCustomers('2026-10-01 00:00:00'),
  ]);

  const total = daily.reduce((sum, row) => sum + Number(row.revenue), 0);

  return (
    <main>
      <h1>Revenue, October</h1>
      <p>{total.toLocaleString()} across {daily.length} days</p>
      <table>
        <tbody>
          {customers.map((row) => (
            <tr key={row.customer_id}>
              <td>{row.customer_id}</td>
              <td>{Number(row.revenue).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

`force-dynamic` stops Next.js from trying to prerender the page at build time, when ClickHouse may be unreachable.

That is a complete internal analytics tool: no BI platform, no separate service. Add the next layer only when a panel needs client-side interaction.

## Step 4: A typed API for interactive panels

The first interactive feature, usually a date picker or a live panel, needs an endpoint. Define each query once with `@hypequery/serve`; it gets zod input validation, an HTTP route and an OpenAPI entry, and stays callable in-process.

```ts
// analytics/api.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { query, serve } = initServe({
  basePath: '/api/analytics',
  context: () => ({ db }),
});

const eventsByType = query({
  description: 'Event counts by type for the last N hours',
  input: z.object({ hours: z.number().int().min(1).max(168).default(24) }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('events')
      .select(['event_type'])
      .count('user_id', 'event_count')
      .where((expr) =>
        expr.fn('greaterOrEquals', expr.col('created_at'),
          expr.fn('subtractHours', expr.fn('now'), input.hours)),
      )
      .groupBy(['event_type'])
      .orderBy('event_count', 'DESC')
      .execute(),
});

const leaderboard = query({
  description: 'Top 10 players by points in the last 24 hours',
  input: z.object({ region: z.string().optional() }),
  query: ({ ctx, input }) => {
    let qb = ctx.db
      .table('score_events')
      .select(['player_id'])
      .sum('points', 'total')
      .where((expr) =>
        expr.fn('greaterOrEquals', expr.col('created_at'),
          expr.fn('subtractHours', expr.fn('now'), 24)),
      );

    if (input.region) {
      qb = qb.where('region', 'eq', input.region);
    }

    return qb.groupBy('player_id').orderBy('total', 'DESC').limit(10).execute();
  },
});

export const api = serve({ queries: { eventsByType, leaderboard } });
```

Mount it in the App Router at `app/api/analytics/[...path]/route.ts`:

```ts
import { createFetchHandler } from '@hypequery/serve';
import { api } from '@/analytics/api';

const handler = createFetchHandler(api.handler);

export const runtime = 'nodejs';
export const GET = handler;
export const POST = handler;
```

Each query is served at `/api/analytics/queries/<name>`, for example `GET /api/analytics/queries/leaderboard?region=eu`. A malformed input gets a validation error before any SQL runs. Server components can skip HTTP and run the same definition with `await api.run('leaderboard', { input: { region: 'eu' } })`.

This API has no auth or tenant scoping, which is fine behind your SSO. If customers will see these panels, add both before you ship: the [multi-tenant embedded analytics guide](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards) covers auth strategies, tenant injection and row policies.

## Step 5: Typed React hooks with polling

Client components must not import the API as a value, or the server code and ClickHouse client end up in the browser bundle. Import its type, plus a route manifest generated from it:

```bash
npx hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json
```

```ts
// lib/analytics.ts
import { createHooks } from '@hypequery/react';
import type { InferApiType } from '@hypequery/serve';
import type { api } from '@/analytics/api';
import manifest from '@/analytics/hypequery-manifest.json';

export const { useQuery } = createHooks<InferApiType<typeof api>>({
  baseUrl: '/api/analytics',
  manifest,
});
```

Wrap the app in TanStack Query's provider once:

```tsx
// app/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Then a live panel is a hook call with a polling interval:

```tsx
// components/EventBreakdown.tsx
'use client';
import { useQuery } from '@/lib/analytics';

export function EventBreakdown() {
  const { data, isLoading, error } = useQuery(
    'eventsByType',
    { hours: 24 },
    { refetchInterval: 15_000 },
  );

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Could not load events.</p>;

  return (
    <table>
      <tbody>
        {data?.map((row) => (
          <tr key={row.event_type}>
            <td>{row.event_type}</td>
            <td>{Number(row.event_count).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

The query name autocompletes from the API, the input is checked against the zod schema, and `data` has the row shape the builder returns. Rename `event_type` in ClickHouse, regenerate, and this component fails to compile.

TanStack Query does the rest: components that show the same query share one request, polling pauses in background tabs by default (`refetchIntervalInBackground` is `false`), and the previous result stays on screen while the next poll is in flight, so the panel does not flash a spinner.

## A Real-Time Leaderboard

A leaderboard is a top-N aggregation that runs often. Store one row per scoring event and aggregate on read; don't maintain running totals per player. Raw events let you compute today, this week or all time from the same table.

### Top 10

```sql
SELECT player_id, sum(points) AS total
FROM score_events
WHERE created_at >= now() - INTERVAL 1 DAY
GROUP BY player_id
ORDER BY total DESC
LIMIT 10
```

The `leaderboard` query above is the builder version. `sum()` over a `UInt32` column returns a `UInt64`, so `total` arrives as a string; convert it where you render.

### A rank column

The array index is the rank until you paginate or show one player's position. Put the rank in the query with a window function. Window functions are not builder methods, so the expression goes through `rawAs`. Compute the totals in a CTE first:

```ts
import { rawAs } from '@hypequery/clickhouse';
import { db } from '@/analytics/client';

const totals = db
  .table('score_events')
  .select(['player_id'])
  .sum('points', 'total')
  .groupBy('player_id');

export const ranked = await db
  .withCTE('totals', totals)
  .table('totals')
  .select([
    'player_id',
    'total',
    rawAs<string, 'rank'>('row_number() OVER (ORDER BY total DESC)', 'rank'),
  ])
  .orderBy('total', 'DESC')
  .limit(10)
  .execute();
```

The CTE matters. When a query has an aggregate, the builder adds the other selected columns to `GROUP BY`, so putting the window function next to `.sum()` produces `GROUP BY player_id, rank`, which ClickHouse rejects with `Aggregate function sum(points) is found in GROUP BY`. In the CTE version the outer query has no aggregate, and `totals` is still typed. `row_number()` returns a `UInt64`, hence `string`. Use `rank()` or `dense_rank()` if ties should share a position; [window functions in TypeScript](/blog/clickhouse-window-functions-typescript) covers the differences.

### A top 10 per region in one query

ClickHouse's `LIMIT n BY column` keeps the first `n` rows for each value of a column:

```sql
SELECT region, player_id, sum(points) AS total
FROM score_events
GROUP BY region, player_id
ORDER BY region ASC, total DESC
LIMIT 10 BY region
```

The builder supports it with `.limitBy()`:

```ts
import { db } from '@/analytics/client';

export const perRegion = await db
  .table('score_events')
  .select(['region', 'player_id'])
  .sum('points', 'total')
  .groupBy(['region', 'player_id'])
  .orderBy('region', 'ASC')
  .orderBy('total', 'DESC')
  .limitBy(10, 'region')
  .execute();
```

The ordering matters: `total DESC` within each region means the 10 rows kept are the top scorers. Group the flat result by `region` on the client and you have every regional board from one round trip. [LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript) goes deeper.

### A polling leaderboard component

```tsx
'use client';
import { useQuery } from '@/lib/analytics';

export function Leaderboard({ region }: { region?: string }) {
  const { data, isLoading, error } = useQuery(
    'leaderboard',
    { region },
    { refetchInterval: 5_000 },
  );

  if (isLoading) return <p>Loading leaderboard…</p>;
  if (error) return <p>Could not load the leaderboard.</p>;

  return (
    <ol>
      {data?.map((row) => (
        <li key={row.player_id}>
          {row.player_id}: {Number(row.total).toLocaleString()} pts
        </li>
      ))}
    </ol>
  );
}
```

At a 5 second interval one open dashboard sends 17,280 queries a day. For a time-filtered aggregation that is usually fine. Measure before optimizing.

### When volume grows: pre-aggregate on insert

If the raw scan gets slow, add a materialized view that keeps per-player totals as events arrive:

```sql
CREATE TABLE score_totals (
  region LowCardinality(String),
  player_id String,
  total UInt64
) ENGINE = SummingMergeTree()
ORDER BY (region, player_id);

CREATE MATERIALIZED VIEW score_totals_mv TO score_totals AS
SELECT region, player_id, sum(points) AS total
FROM score_events
GROUP BY region, player_id;
```

`SummingMergeTree` combines rows with the same key during background merges, which may not have happened yet when you read, so keep the `sum()` in the leaderboard query:

```sql
SELECT player_id, sum(total) AS total
FROM score_totals
GROUP BY player_id
ORDER BY total DESC
LIMIT 10
```

This gives all-time totals; rolling windows need the time bucket in the key, such as `toStartOfHour(created_at)`. Like any materialized view, it only sees rows inserted after it is created, so backfill existing events. The [materialized views guide](/blog/a-guide-to-materialized-views-in-clickhouse) covers backfills and engines.

## Shared filters across panels

Dashboards often apply the same filters to several panels. A `CrossFilter` holds the conditions once and applies them to any query on that table:

```ts
import { CrossFilter } from '@hypequery/clickhouse';
import { db } from '@/analytics/client';
import type { IntrospectedSchema } from '@/analytics/schema';

const filters = new CrossFilter<IntrospectedSchema, 'orders'>()
  .add({ column: 'status', operator: 'eq', value: 'completed' })
  .add({ column: 'created_at', operator: 'gte', value: '2026-10-01 00:00:00' });

export const [byCustomer, orderCount] = await Promise.all([
  db.table('orders').select(['customer_id']).sum('total', 'revenue')
    .applyCrossFilters(filters).groupBy('customer_id').execute(),
  db.table('orders').count('id', 'orders').applyCrossFilters(filters).execute(),
]);
```

## Mistakes that break ClickHouse dashboards

- **Querying ClickHouse from the browser.** Credentials leak and any SQL can run.
- **Hand-written row types.** They drift from the schema and hide that `UInt64` values are strings. Generate them.
- **Math on unconverted aggregates.** `a + b` on two string counts concatenates. Convert with `Number()` first.
- **`SELECT *` in dashboard queries.** A renamed column comes back under a new key and the panel shows blanks. Select named columns so a rename fails the build.
- **Customer-facing panels without tenant scoping.** Before customers see a panel, follow the [multi-tenant guide](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards).

## Where to go from here

- [ClickHouse dashboard](/clickhouse-dashboard): the architecture overview for dashboard backends.
- [ClickHouse React](/clickhouse-react): hooks, providers and parameterized queries in more depth.
- [ClickHouse Next.js](/clickhouse-nextjs): server components, route handlers and where the connection lives.
- [ClickHouse real-time analytics](/clickhouse-real-time-analytics): the wider pattern the leaderboard belongs to.
