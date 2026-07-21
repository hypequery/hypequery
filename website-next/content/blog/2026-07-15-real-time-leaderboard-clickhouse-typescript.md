---
title: "How to Build a Real-Time Leaderboard with ClickHouse and TypeScript"
description: "Build a real-time leaderboard on ClickHouse: top-N aggregation, rank columns with row_number(), per-region leaderboards in one query with LIMIT BY, and a typed API with polling React hooks."
seoTitle: "Real-Time Leaderboard with ClickHouse and TypeScript"
seoDescription: "How to build a real-time leaderboard in ClickHouse with TypeScript: top-N queries, rank columns, per-segment leaderboards with LIMIT BY, and a polling React hook."
pubDate: 2026-07-15
heroImage: ""
slug: real-time-leaderboard-clickhouse-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

A leaderboard is a top-N aggregation query that runs often. That's the whole architecture.

**Short answer:** store score events in a MergeTree table, aggregate with `sum(points) ... GROUP BY player_id ORDER BY total DESC LIMIT 10`, expose that query behind a typed HTTP endpoint, and poll it from React every few seconds. ClickHouse aggregates millions of raw events in tens of milliseconds, so you don't need Redis sorted sets, a precomputed ranking table, or a streaming pipeline to get a leaderboard that feels live. In hypequery, the core query is:

```ts
const top10 = await db
  .table('score_events')
  .select(['player_id'])
  .sum('points', 'total')
  .groupBy('player_id')
  .orderBy('total', 'DESC')
  .limit(10)
  .execute();
```

This post builds the whole thing end to end: the table, the top-N query, a proper rank column, per-region leaderboards in a single query with ClickHouse's `LIMIT BY`, a governed API endpoint, and a React hook that polls it. If you don't have a typed ClickHouse setup yet, the [quick start](/docs/quick-start) gets you from a live schema to generated TypeScript types in a few minutes, and the [real-time analytics](/clickhouse-real-time-analytics) page covers the broader pattern this tutorial is one instance of.

## The table

Write one row per scoring event. Don't maintain a running total per player — append-only inserts are what ClickHouse is built for, and keeping raw events means you can recompute the leaderboard over any time window (today, this week, all time) with the same table.

```sql
CREATE TABLE score_events (
  player_id String,
  region LowCardinality(String),
  points UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at, player_id);
```

Sorting by `created_at` first fits the access pattern: leaderboards are almost always windowed ("this week's top players"), so most queries filter on time, and ClickHouse can skip everything outside the window.

Generate types from the live schema and connect:

```bash
npx @hypequery/cli generate
```

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

## Step 1: the top-10 query

The SQL is a plain aggregation:

```sql
SELECT player_id, sum(points) AS total
FROM score_events
WHERE created_at >= now() - INTERVAL 1 DAY
GROUP BY player_id
ORDER BY total DESC
LIMIT 10
```

The hypequery version, with a rolling 24-hour window:

```ts
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

const top10 = await db
  .table('score_events')
  .select(['player_id'])
  .sum('points', 'total')
  .where('created_at', 'gte', hoursAgo(24))
  .groupBy('player_id')
  .orderBy('total', 'DESC')
  .limit(10)
  .execute();
```

Column names in `.select()`, `.groupBy()`, and `.orderBy()` are checked against the generated `score_events` type, so a typo like `'player_ids'` fails at compile time.

One runtime detail worth knowing up front: `sum()` over a `UInt32` column returns a `UInt64`, and ClickHouse serializes `UInt64` to JavaScript as a **string** to avoid precision loss. hypequery's generated types reflect that, so `total` is typed `string` — convert with `Number(row.total)` at the display layer, not in the query.

## Step 2: a real rank column

For a plain top 10 the array index is the rank. It stops being enough the moment you paginate ("ranks 51–60") or show a player's position badge, because the offset math leaks into every consumer. Put the rank in the query with `row_number()`:

```sql
SELECT
  player_id,
  sum(points) AS total,
  row_number() OVER (ORDER BY sum(points) DESC) AS rank
FROM score_events
WHERE created_at >= now() - INTERVAL 1 DAY
GROUP BY player_id
ORDER BY total DESC
LIMIT 10
```

Window functions run after `GROUP BY`, so ranking over an aggregate like `sum(points)` is valid ClickHouse. In hypequery, window functions are not first-class builder methods — there's no `.rowNumber()` — so the window expression goes through `selectExpr()` while the rest of the query stays typed:

```ts
import { selectExpr } from '@hypequery/clickhouse';

const ranked = await db
  .table('score_events')
  .select([
    'player_id',
    selectExpr('row_number() OVER (ORDER BY sum(points) DESC)', 'rank'),
  ])
  .sum('points', 'total')
  .where('created_at', 'gte', hoursAgo(24))
  .groupBy('player_id')
  .orderBy('total', 'DESC')
  .limit(10)
  .execute();
```

If you want ties to share a rank, swap in `rank()` or `dense_rank()` — the tradeoffs are covered in [ClickHouse window functions in TypeScript](/blog/clickhouse-window-functions-typescript).

## Step 3: per-region leaderboards in one query

Now the requirement that breaks most stacks: a leaderboard *per region*. Top 10 in EU, top 10 in NA, top 10 in APAC. In standard SQL that's a subquery with `row_number() OVER (PARTITION BY region ...)` plus an outer filter — or worse, one query per region in an application loop.

ClickHouse has a dedicated clause for exactly this: `LIMIT BY`.

```sql
SELECT region, player_id, sum(points) AS total
FROM score_events
WHERE created_at >= now() - INTERVAL 1 DAY
GROUP BY region, player_id
ORDER BY region, total DESC
LIMIT 10 BY region
```

One flat query, and every region comes back with its own top 10. hypequery supports the clause natively with `.limitBy()` — no raw SQL needed:

```ts
const perRegion = await db
  .table('score_events')
  .select(['region', 'player_id'])
  .sum('points', 'total')
  .where('created_at', 'gte', hoursAgo(24))
  .groupBy(['region', 'player_id'])
  .orderBy('region', 'ASC')
  .orderBy('total', 'DESC')
  .limitBy(10, 'region')
  .execute();
```

The ordering pair matters: `region ASC` keeps each region's rows together, and `total DESC` within a region means the 10 rows `LIMIT BY` keeps are the highest scorers. Group the flat result by `region` in one pass on the client and you have every regional leaderboard from a single round trip. This clause is one of ClickHouse's most useful non-standard features — [ClickHouse LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript) goes deeper on how it differs from `LIMIT` and window functions.

## Step 4: the API endpoint

Don't let components query ClickHouse directly. Wrap the leaderboard in a `@hypequery/serve` endpoint so input validation, auth hooks, and the response contract live in one place:

```ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const leaderboard = query({
  description: 'Top 10 players by points, optionally scoped to a region',
  input: z.object({ region: z.string().optional() }),
  query: ({ ctx, input }) => {
    let qb = ctx.db
      .table('score_events')
      .select(['player_id'])
      .sum('points', 'total')
      .where('created_at', 'gte', hoursAgo(24));

    if (input.region) {
      qb = qb.where('region', 'eq', input.region);
    }

    return qb
      .groupBy('player_id')
      .orderBy('total', 'DESC')
      .limit(10)
      .execute();
  },
});

export const api = serve({ queries: { leaderboard } });
```

A request with a malformed `region` is rejected by zod before any SQL runs, and the same query definition works in-process via `api.execute('leaderboard', { input: { region: 'eu' } })` — useful for tests and server-side rendering.

## Step 5: the React hook with polling

The "real-time" part is deliberately boring: poll. A leaderboard that refreshes every five seconds is indistinguishable from a streamed one for users, and polling keeps the stack at exactly one moving part. [`@hypequery/react`](/clickhouse-react) wraps the serve endpoint in TanStack Query hooks, so polling is one option:

```tsx
// hooks/analytics.ts
import { createHooks } from '@hypequery/react';

export const { useQuery } = createHooks({
  baseUrl: 'http://localhost:3001',
});
```

```tsx
// Leaderboard.tsx
import { useQuery } from './hooks/analytics';

export function Leaderboard({ region }: { region?: string }) {
  const { data, isLoading, error } = useQuery('leaderboard', { region }, {
    refetchInterval: 5_000, // poll every 5 seconds
  });

  if (isLoading) return <div>Loading leaderboard…</div>;
  if (error) return <div>Failed to load leaderboard</div>;

  return (
    <ol>
      {data?.map((row) => (
        <li key={row.player_id}>
          {row.player_id} — {Number(row.total).toLocaleString()} pts
        </li>
      ))}
    </ol>
  );
}
```

TanStack Query handles the rest: it dedupes requests across components showing the same board, pauses polling in background tabs, and keeps the previous result on screen while the next poll is in flight, so the list never flickers to a spinner. `Number(row.total)` is where the `UInt64`-as-string convention from step 1 gets converted, and nowhere else.

At a 5-second interval, one dashboard generates 17k queries a day. That sounds like a lot; for a ClickHouse aggregation over a time-filtered MergeTree table it's nothing. Measure before you optimize.

## When volume grows: materialized views

At some point scanning raw events on every poll stops being free — usually around hundreds of millions of rows in the window, or hundreds of concurrent viewers. The ClickHouse-native fix is a materialized view that pre-aggregates on insert into an `AggregatingMergeTree` (or `SummingMergeTree` for a simple `sum`) target table:

```sql
CREATE MATERIALIZED VIEW score_totals_mv
ENGINE = SummingMergeTree()
ORDER BY (region, player_id)
AS SELECT region, player_id, sum(points) AS total
FROM score_events
GROUP BY region, player_id;
```

The leaderboard query then reads a few thousand pre-aggregated rows instead of millions of raw events, and inserts keep it current — no cron job, no cache invalidation. Your application query barely changes: point the builder at the view's target table and keep the same `ORDER BY total DESC LIMIT 10` shape. The mechanics, including the eventual-merge semantics you need to understand before trusting the numbers, are covered in [the guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse).

Don't start there. Raw-table aggregation is simpler to reason about, handles arbitrary time windows for free, and is fast enough for far longer than most teams expect.

## Where to go from here

- [ClickHouse real-time analytics](/clickhouse-real-time-analytics) — the broader architecture this leaderboard is a slice of
- [ClickHouse LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript) — the top-N-per-group clause in depth
- [ClickHouse window functions in TypeScript](/blog/clickhouse-window-functions-typescript) — `row_number()`, `rank()`, and the frame gotchas
- [Building a real-time dashboard with React](/blog/clickhouse-real-time-dashboard-react) — the same serve + hooks stack applied to a full dashboard
