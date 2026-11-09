---
title: "ClickHouse in Node.js: Adding Analytics to a Production Backend"
description: "Add ClickHouse analytics to an existing Express, Fastify or Nest app and run it in production: generated types, one client per process, timeouts and retries, testing queries against a real engine, and SAMPLE for fast prototyping."
seoTitle: "ClickHouse in Node.js: A Production Guide"
seoDescription: "Add ClickHouse to a Node.js backend and run it in production: typed queries, one client per process, timeouts, testing, and SAMPLE for prototyping."
pubDate: 2026-07-03
updated: 2026-11-08
heroImage: ""
slug: add-clickhouse-analytics-nodejs-backend
status: published
tags:
  - ClickHouse
  - TypeScript
---

To add ClickHouse to an existing Node.js backend, install `@hypequery/clickhouse`, run `npx hypequery generate` against your live ClickHouse to get TypeScript types for every table, create one query builder per process where your app already builds its clients, and ship one endpoint. Nothing changes in your Postgres or ORM setup. For production, keep that single client, set timeouts on both the client and the server, retry only network errors, and test queries against a real ClickHouse engine rather than mocks.

Every SQL statement and builder query in this guide was run against ClickHouse 26.6. For the wider picture, see the [ClickHouse Node.js guide](/clickhouse-nodejs).

## Quick answers

### Do I need a connection pool for ClickHouse in Node.js?

Not a Postgres-style pool. ClickHouse clients talk HTTP, and the official `@clickhouse/client` (which hypequery uses) keeps a pool of keep-alive sockets inside each client instance. Create one client per process and reuse it. `max_open_connections` (default 10) caps concurrent requests.

### How do I test ClickHouse queries in TypeScript?

Three layers: `tsc --noEmit` in CI catches wrong columns and types, `toSQL()` assertions check generated SQL without a database, and integration tests run queries against a real engine, either embedded [chDB](/docs/chdb) or a ClickHouse container. See [testing](#testing-clickhouse-queries).

### Does hypequery support the SAMPLE clause?

There is no `.sample()` builder method. Use approximate aggregates like `quantile()` and `uniq()` in the builder, or send a `SAMPLE` query through `db.rawQuery()`. See [sampling](#sampling-for-fast-prototyping).

### Does adding ClickHouse affect my existing ORM?

No. Postgres and your ORM keep the transactional data; ClickHouse holds events and aggregates. They share nothing but application code, so the change is reversible.

---

## Why this is not like adding another ORM

Your ORM can't help here. Prisma and Drizzle have no native ClickHouse driver, and TypeORM's entity model doesn't fit a columnar, append-heavy database (more in [ClickHouse and ORMs](/clickhouse-orm)).

The direction of truth also flips. ClickHouse tables usually exist before the application code: a data engineer created them, or a pipeline already writes events into them. So instead of models and migrations, point a generator at the live database and derive types from what is there.

## Step 1: Generate types from the live database

```bash
npm install @hypequery/clickhouse
npm install -D @hypequery/cli
npx hypequery generate --output src/analytics/schema.ts
```

The CLI reads `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD`, introspects every table, and writes an `IntrospectedSchema` type. Commit it, and re-run the command when the ClickHouse schema changes. The examples use this table:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type LowCardinality(String),
  duration_ms UInt32,
  created_at DateTime
) ENGINE = MergeTree
ORDER BY (tenant_id, created_at);
```

## Step 2: One query builder per process

Create the builder once, at startup:

```ts
// src/analytics/client.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

export const analytics = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 30_000,
  max_open_connections: 10,
  clickhouse_settings: {
    max_execution_time: 25,
  },
});
```

In Express, this module-level singleton is the whole integration. In Fastify, decorate the app once (`app.decorate('analytics', analytics)`). In Nest, register it as a provider with `useFactory: () => createQueryBuilder<IntrospectedSchema>({ ... })` so it flows through DI like your repositories.

## Step 3: Ship one endpoint

Pick the one chart your product needs most and put it behind one route:

```ts
// src/routes/analytics.ts
import { Router } from 'express';
import { selectExpr } from '@hypequery/clickhouse';
import { analytics } from '../analytics/client';

export const analyticsRouter = Router();

analyticsRouter.get('/events/daily', async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId as number; // set by your auth middleware
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

    const rows = await analytics
      .table('events')
      .select([selectExpr('toStartOfDay(created_at)', 'day')])
      .count('user_id', 'total_events')
      .countDistinct('user_id', 'unique_users')
      .where('tenant_id', 'eq', tenantId)
      .where((expr) =>
        expr.fn('greaterOrEquals', expr.col('created_at'),
          expr.fn('subtractDays', expr.fn('now'), days)),
      )
      .groupBy(['day'])
      .orderBy('day', 'ASC')
      .execute();

    res.json(rows);
  } catch (err) {
    next(err);
  }
});
```

Mount it next to your existing routes with `app.use('/api/analytics', analyticsRouter)`.

- **The tenant comes from your existing auth middleware.** ClickHouse queries slot into the request lifecycle where your Postgres queries do. Never read it from the query string.
- **Values are bound parameters.** `tenantId` and `days` are sent as parameters, not pasted into SQL.
- **The result is typed.** `day` is a string such as `"2026-11-08 00:00:00"`. `total_events` and `unique_users` are strings too: `count()` returns a `UInt64`, and hypequery asks ClickHouse to quote 64-bit integers so values above 2^53 stay exact.
- **A misspelled column fails the build.** `where('tennant_id', ...)` is a TypeScript error, not a production exception.

Deploy it. One endpoint in production tells you more about latency, auth and data quality than a week of local work.

## Running it in production

### Reuse the client; don't create one per request

```ts
// Don't: a new client per request means a new socket pool per request
app.get('/analytics', async (_req, res) => {
  const perRequest = createQueryBuilder<IntrospectedSchema>({ url: process.env.CLICKHOUSE_URL! });
  res.json(await perRequest.table('events').count('user_id', 'n').execute());
});
```

Each client opens its own keep-alive sockets, so per-request clients lose connection reuse and leave idle sockets behind. In `@clickhouse/client`, keep-alive is on by default and idle sockets are dropped after 2.5 seconds (`keep_alive.idle_socket_ttl`), below the server's `keep_alive_timeout`, which is 30 seconds on 26.6.

On shutdown, close the client so in-flight sockets are released:

```ts
process.on('SIGTERM', async () => {
  await analytics.close();
  process.exit(0);
});
```

### Set timeouts on both sides

`request_timeout` (default 30 seconds) stops your process waiting forever. `max_execution_time` (seconds) makes ClickHouse stop the query itself. Set the server limit a little below the client one, as in the client above, so ClickHouse returns a clear `TIMEOUT_EXCEEDED` error instead of the client giving up while the query keeps running. For per-request cancellation, pass an abort signal: `.execute({ abortSignal })`.

If your ClickHouse user is `readonly = 1`, it rejects per-query settings, including the 64-bit quoting setting hypequery sends. Use `readonly = 2`, or set the values in the user's profile; the [read-only users reference](/docs/reference/readonly-users) has the details.

### Retry network errors only

```ts
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 200): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0 && isRetryable(err)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED';
}
```

Syntax errors, unknown columns and timeouts from `max_execution_time` fail the same way on retry. Retrying them just adds load.

### Serverless

A module-level client works in serverless functions too. A cold start creates it; warm invocations reuse it. Creating a client is an object allocation, and the first query opens the first socket.

## Testing ClickHouse queries

ClickHouse has no transactions to roll back after each test, and its SQL dialect differs enough from Postgres that SQLite or Postgres stand-ins are not useful. Test in three layers.

### 1. Type-check in CI

`npx tsc --noEmit` against the generated schema catches wrong table and column names and malformed filters before any test runs:

```ts
// @ts-expect-error: no such column
analytics.table('events').select(['user_idd']);

// @ts-expect-error: 'in' takes an array of values
analytics.table('events').where('event_type', 'in', 'view');
```

### 2. Assert the generated SQL

`toSQL()` renders the query without touching the database, which suits checks on the parts that matter, such as the tenant filter:

```ts
import { describe, expect, it } from 'vitest';
import { analytics } from './analytics/client';

describe('daily events query', () => {
  it('always filters by tenant', () => {
    const sql = analytics
      .table('events')
      .count('user_id', 'total_events')
      .where('tenant_id', 'eq', 42)
      .toSQL();

    expect(sql).toContain('WHERE tenant_id = 42');
  });
});
```

### 3. Run queries against a real engine

For aggregations, window functions and anything where you want to see the numbers, run against ClickHouse itself. [chDB](/docs/chdb) runs ClickHouse in-process, so tests need no container, and the builder code is the same code you ship:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { Session } from 'chdb';
import { chdbAdapter } from 'chdb/hypequery';
import type { IntrospectedSchema } from './analytics/schema';

const session = new Session(); // in-memory, discarded when the process exits
export const testDb = createQueryBuilder<IntrospectedSchema>({
  adapter: chdbAdapter({ session }),
});
```

If you'd rather test against the server version you run in production, use a container:

```yaml
# docker-compose.test.yml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:26.6
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_DB: test_db
      CLICKHOUSE_USER: test
      CLICKHOUSE_PASSWORD: test
```

Seed each test with only the rows it needs. Against a server, the typed insert builder checks seed rows against the schema too. The chDB adapter (chdb 3.5) does not implement inserts, so seed it with `rawQuery('INSERT INTO events VALUES ...')` instead.

```ts
import { afterEach, beforeEach, expect, it } from 'vitest';
import { analytics } from './analytics/client';

beforeEach(async () => {
  await analytics.rawQuery('TRUNCATE TABLE IF EXISTS events');
  await analytics
    .insert('events')
    .values([
      { tenant_id: 42, user_id: 'u1', event_type: 'view', duration_ms: 120, created_at: '2026-11-08 10:00:00' },
      { tenant_id: 42, user_id: 'u2', event_type: 'click', duration_ms: 80, created_at: '2026-11-08 11:00:00' },
      { tenant_id: 42, user_id: 'u1', event_type: 'view', duration_ms: 95, created_at: '2026-11-08 12:00:00' },
      { tenant_id: 7, user_id: 'u9', event_type: 'view', duration_ms: 60, created_at: '2026-11-08 12:00:00' },
    ])
    .execute();
});

afterEach(async () => {
  await analytics.rawQuery('TRUNCATE TABLE IF EXISTS events');
});

it('counts unique users for one tenant', async () => {
  const [row] = await analytics
    .table('events')
    .countDistinct('user_id', 'unique_users')
    .where('tenant_id', 'eq', 42)
    .execute();

  expect(Number(row.unique_users)).toBe(2);
});
```

Compare counts with `Number()`: in our run, chDB returned `unique_users` as the number `2`, while the HTTP adapter returns the string `"2"`. Keep the test database separate from dev and production, and in CI wait for the container's HTTP port to answer `SELECT 1` before running the suite.

## Sampling for fast prototyping

When you iterate on an expensive query, a fast, roughly-right answer is often enough. `SAMPLE 0.1` makes ClickHouse read about 10% of a table and run the query on that subset.

### The table needs SAMPLE BY

```sql
CREATE TABLE events_sampled (
  user_id UInt64,
  event_type LowCardinality(String),
  page_path String,
  duration_ms UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (event_type, created_at, cityHash64(user_id))
SAMPLE BY cityHash64(user_id);
```

What we saw on 26.6:

- The sampling expression must be in the sort key. Otherwise `CREATE TABLE` fails with `Sampling expression must be present in the primary key`.
- `SAMPLE` on a table without `SAMPLE BY` fails with `doesn't support sampling`. If the expression is already in the sort key, you can add it later with `ALTER TABLE ... MODIFY SAMPLE BY`; if not, you need a new table.
- Sampling is deterministic. Two runs of the same `SAMPLE 0.1` query on the same data returned the same count.
- Sampling by `cityHash64(user_id)` samples users, not rows: every event of a sampled user is included, so per-user metrics stay coherent.

### Scale the results

On 2,000,000 rows from 50,000 users:

```sql
SELECT count() * any(_sample_factor) AS estimated_events  -- 1,949,600
FROM events_sampled SAMPLE 0.1;

SELECT count() * any(_sample_factor) AS estimated_events  -- 2,002,000
FROM events_sampled SAMPLE 0.1 OFFSET 0.5;

SELECT uniq(user_id) * any(_sample_factor) AS estimated_users  -- 48,740 (exact: 50,000)
FROM events_sampled SAMPLE 0.1;
```

Scale additive results (`count()`, `sum()`), and distinct users when the sample key is the user hash. Don't scale `avg()`, quantiles or ratios. `_sample_factor` is the virtual column ClickHouse provides, so the multiplier can't drift from the fraction. `SAMPLE 100000` asks for roughly that many rows instead of a fraction. `OFFSET 0.5` reads a different 10% slice: if two slices agree, the estimate is probably stable.

### From TypeScript

hypequery has no `.sample()` method. Most of the time you don't need one: what made the exact query slow was a distinct count or a percentile, and ClickHouse's approximate functions work on any table:

```ts
import { rawAs } from '@hypequery/clickhouse';
import { analytics } from './analytics/client';

export const latency = await analytics
  .table('events')
  .select(['event_type', rawAs<string, 'unique_users'>('uniq(user_id)', 'unique_users')])
  .quantile('duration_ms', 0.95, 'p95_duration_ms')
  .where('tenant_id', 'eq', 42)
  .groupBy(['event_type'])
  .execute();
```

`.countDistinct()` emits `COUNT(DISTINCT ...)`, which ClickHouse runs as the exact, memory-heavy `uniqExact` by default. Add `.settings({ count_distinct_implementation: 'uniq' })` to get the approximate version without changing the query.

When you do need `SAMPLE`, send it through the same client with `rawQuery`, which still binds parameters:

```ts
import { analytics } from './analytics/client';

export const estimate = await analytics.rawQuery<{ page_path: string; estimated_views: number }>(
  `SELECT page_path, count() * any(_sample_factor) AS estimated_views
   FROM events_sampled SAMPLE 0.1
   WHERE created_at >= now() - INTERVAL ? DAY
   GROUP BY page_path
   ORDER BY estimated_views DESC
   LIMIT 20`,
  [7],
);
```

You write the row type yourself for this one query. `estimated_views` is a `Float64` because `_sample_factor` is a float, so it arrives as a number. That trade is fine for a prototyping loop: explore with `SAMPLE`, check the final shape once without it, then port the query to the builder with exact or approximate aggregates. Don't ship sampled numbers with hand-kept scaling factors to billing or customer-facing pages.

## Growing from one endpoint

Expansion is repetition: another route, another builder chain, the same client. Two signals tell you to add structure:

- **Route handlers fill with parse-validate-query boilerplate.** `@hypequery/serve` turns query definitions into HTTP routes with zod validation and OpenAPI docs, and mounts inside your existing Express app. See [ClickHouse with Express](/clickhouse-express).
- **Several endpoints define "revenue" slightly differently.** That's the cue for [`@hypequery/datasets`](/clickhouse-semantic-layer): define dimensions and measures once and reuse them.

If the endpoints become customer-facing, scope every query to a tenant before you ship. The [multi-tenant analytics guide](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards) covers tenant injection and ClickHouse row policies.

## Where to go from here

- [ClickHouse Node.js guide](/clickhouse-nodejs): the overview of running ClickHouse from Node.js.
- [Why ClickHouse types break in TypeScript](/blog/clickhouse-typescript-type-problem): the runtime type mappings behind the strings above.
- [chDB](/docs/chdb): embedded ClickHouse for tests and local development.
- [Quick start](/docs/quick-start): install to first typed query.
