---
title: "How to Add ClickHouse Analytics to an Existing Node.js Backend"
description: "A retrofit guide for adding ClickHouse analytics to a running Express, Fastify, or Nest app: generate types from your live schema, wire one query builder into your existing DI, and ship a single endpoint before expanding."
seoTitle: "Add ClickHouse to an Existing App: Node.js Retrofit Guide"
seoDescription: "Add ClickHouse to an existing Node.js app: generate TypeScript types from your live schema, wire a typed query builder into Express or Nest, and ship one endpoint first."
pubDate: 2026-07-03
heroImage: ""
slug: add-clickhouse-analytics-nodejs-backend
status: published
tags:
  - ClickHouse
  - TypeScript
---

You have a production Node.js backend — Express, Fastify, or Nest — with Postgres and an ORM handling transactional data. Now the product needs analytics: event counts, usage charts, revenue over time. This is a guide to adding ClickHouse to that app as it exists today, not to starting a new one.

**Short answer:** install `@hypequery/clickhouse`, run `npx hypequery generate` against your live ClickHouse instance to get TypeScript types for every table, create one `createQueryBuilder` instance wherever your app already constructs its clients, and ship a single analytics endpoint. There are no migrations to write and nothing changes in your existing Postgres or ORM setup. hypequery is database-first: it introspects whatever schema already exists and sits beside your current stack.

The whole retrofit is four steps. If you want the condensed version, the [quick start](/docs/quick-start) covers install-to-first-query, and the [ClickHouse Node.js guide](/clickhouse-nodejs) covers the broader architecture. This post walks the steps in the order you'd actually do them in an existing codebase.

## Why this is not like adding another ORM

The instinct when adding a second database to a Node.js app is to reach for the pattern you already use: define models, write migrations, sync the schema from code. That pattern does not transfer, for two reasons.

First, your existing ORM cannot help. Prisma and Drizzle have no native ClickHouse driver, and TypeORM's entity model doesn't map to a columnar, append-heavy database at all (more on coexistence in [Prisma and ClickHouse](/prisma-clickhouse)). ClickHouse needs its own client layer.

Second, the direction of truth flips. With ClickHouse the schema usually exists before the application code does — an ops or data engineer created the tables, or a managed pipeline is already writing events into them. A code-first, migration-driven workflow fights that reality. A database-first workflow embraces it: point a generator at the live database and derive the types from what is actually there.

That second point is what makes incremental adoption cheap. You don't model anything, you don't migrate anything, and you don't touch the Postgres side. You introspect, query, and ship.

## Prerequisite: a ClickHouse instance with at least one table

If ClickHouse is already running with data in it, skip ahead. If you're adding ClickHouse specifically for product events, a minimal table is enough to start:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type LowCardinality(String),
  properties String,
  created_at DateTime
) ENGINE = MergeTree
ORDER BY (tenant_id, created_at);
```

Your app can write events to this table with the official [ClickHouse JS client](/clickhouse-js) (`@clickhouse/client`), which is also what hypequery uses under the hood for transport. The read path — the part users see — is what the rest of this post builds.

## Step 1: install and generate types from the live database

```bash
npm install @hypequery/clickhouse
npx hypequery generate --output src/analytics/schema.ts
```

The CLI connects to your ClickHouse instance, introspects every table, and writes a typed schema file. This is the step that replaces the entire "define models" phase of an ORM workflow: the generated file already reflects your real columns, including the runtime mappings that trip up hand-written types — `UInt64` arrives as a `string` in JavaScript, `DateTime` arrives as a formatted string, `Nullable(T)` becomes `T | null`.

The output is a plain TypeScript file. Commit it like any other generated artifact, and re-run the command when the ClickHouse schema changes. Nothing about your existing migration tooling is involved.

## Step 2: wire one query builder into your existing app

Create the builder once, at startup, in the same place your app already builds its database clients.

```ts
// src/analytics/client.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const analytics = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

In an Express app, a module-level singleton like this is the whole integration — import `analytics` wherever you need it. In Fastify, decorate the instance once so handlers reach it through the app object:

```ts
app.decorate('analytics', analytics);
// handlers: request.server.analytics.table('events')...
```

In Nest, register it as a provider so it flows through the DI container like your existing repositories:

```ts
{
  provide: 'ANALYTICS',
  useFactory: () =>
    createQueryBuilder<IntrospectedSchema>({
      url: process.env.CLICKHOUSE_URL!,
      username: process.env.CLICKHOUSE_USERNAME!,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: process.env.CLICKHOUSE_DATABASE!,
    }),
}
```

One instance for the process lifetime is the right shape in all three frameworks. hypequery talks to ClickHouse over HTTP, so there is no persistent connection pool to size the way you would with `pg` — but keep-alive behavior and concurrency still matter under load, and [ClickHouse connection handling in Node.js](/blog/clickhouse-connection-pooling-nodejs) covers what to tune when this endpoint starts taking real traffic.

## Step 3: ship one endpoint

Resist the urge to build the whole analytics module first. Pick the single chart or number your product needs most — daily events is the usual candidate — and put it behind one route in your existing router:

```ts
// src/routes/analytics.ts
import { Router } from 'express';
import { selectExpr } from '@hypequery/clickhouse';
import { analytics } from '../analytics/client.js';

export const analyticsRouter = Router();

analyticsRouter.get('/events/daily', async (req, res, next) => {
  try {
    const tenantId = req.auth.tenantId; // set by your existing auth middleware
    const days = Number(req.query.days ?? 30);
    const since = new Date(Date.now() - days * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    const rows = await analytics
      .table('events')
      .select([selectExpr('toStartOfDay(created_at)', 'day')])
      .count('user_id', 'total_events')
      .countDistinct('user_id', 'unique_users')
      .where('tenant_id', 'eq', tenantId)
      .where('created_at', 'gte', since)
      .groupByTimeInterval('created_at', '1 day', 'toStartOfDay')
      .orderBy('day', 'ASC')
      .execute();

    res.json(rows);
  } catch (err) {
    next(err);
  }
});
```

Mount it next to your existing routes:

```ts
app.use('/api/analytics', analyticsRouter);
```

A few things worth noticing about what you just shipped:

- **The tenant filter comes from your existing auth middleware.** Nothing about your session handling, middleware chain, or error handler changed. ClickHouse queries slot into the request lifecycle exactly where your Postgres queries do.
- **The result is typed end to end.** `day` is a `string` (ClickHouse returns `DateTime` as a formatted string), and `total_events` is a `string` too, because `count()` returns `UInt64`, which can exceed `Number.MAX_SAFE_INTEGER`. The generated types surface both facts at compile time instead of in production.
- **Misspell a column and it fails at build time.** `where('tennant_id', ...)` is a TypeScript error, not a 3 a.m. ClickHouse exception.

Deploy this. One endpoint in production teaches you more about your ClickHouse setup — latency, auth, data quality — than a week of building the full module locally.

## Step 4: expand from the working endpoint

Once the first endpoint is live, expansion is repetition: another route, another builder chain against the generated schema. A revenue-by-region endpoint, a top-events endpoint, a retention query. Each one reuses the same singleton client and the same middleware.

Two signals tell you it's time to reach for more structure:

**Route handlers start accumulating boilerplate.** When every handler is parse-input, run-query, serialize, consider `@hypequery/serve`, which turns query definitions into governed HTTP routes with zod input validation and OpenAPI docs. It mounts into your existing Express app rather than replacing it — the [Express integration guide](/clickhouse-express) shows the full pattern.

**Multiple endpoints reimplement the same metric.** When "revenue" is defined slightly differently in three handlers, that's the cue for `@hypequery/datasets`, which lets you define dimensions and measures once and reuse them across endpoints.

Neither is required on day one. The query builder alone is a complete integration.

## What happens to your existing Postgres and ORM stack

Nothing, and that's the point. The pattern that works in practice is a clean split by workload:

- **Postgres + your ORM** keeps owning transactional data: users, accounts, subscriptions, anything with row-level updates and foreign keys.
- **ClickHouse + hypequery** owns the analytical data: events, aggregates, time series, anything you count or chart.

The two sides share nothing but your application code. There is no shared migration history to coordinate, no ORM plugin to configure, no risk that adding the analytics path destabilizes the transactional one. hypequery's schema file is a read-only artifact generated from the analytics database; your Prisma or Drizzle schema never learns ClickHouse exists.

That isolation is also what makes the retrofit reversible. If you shipped the one endpoint and decided ClickHouse wasn't the right call, you'd delete a router file, a client module, and a generated schema file — nothing else in the codebase would notice.

## Where to go from here

- [ClickHouse with Express](/clickhouse-express) — deeper Express patterns, including typed HTTP routes with `@hypequery/serve`
- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics) — hardening the `tenant_id` filter from this post into enforced tenant isolation
- [ClickHouse Node.js guide](/clickhouse-nodejs) — the full picture of running ClickHouse from a Node.js backend
- [ClickHouse connection handling in Node.js](/blog/clickhouse-connection-pooling-nodejs) — what to tune when the analytics endpoints take production traffic
