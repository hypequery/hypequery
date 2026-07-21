---
title: "Does Prisma Support ClickHouse? What to Use Instead"
description: "Prisma has no ClickHouse connector, and the MySQL-compat-port workaround breaks on real analytics workloads. Here's why, and the Prisma-plus-ClickHouse-native pattern teams actually run in production."
seoTitle: "Does Prisma Support ClickHouse? No — Here's What to Use Instead"
seoDescription: "Does Prisma support ClickHouse? No — there is no ClickHouse connector. Learn why the MySQL port 9004 workaround fails and how to pair Prisma with a type-safe ClickHouse layer."
pubDate: 2026-07-01
heroImage: ""
slug: does-prisma-support-clickhouse
status: published
tags:
  - ClickHouse
  - TypeScript
---

No — Prisma does not support ClickHouse. There is no ClickHouse connector, and the feature requests tracking one ([#16174](https://github.com/prisma/prisma/issues/16174) and [#23292](https://github.com/prisma/prisma/issues/23292)) have been open for years without a connector on the roadmap.

**Short answer:** you cannot point Prisma at ClickHouse and expect it to work. The one workaround people try — Prisma's MySQL provider against ClickHouse's MySQL compatibility port (9004) — breaks quickly on real workloads because ClickHouse only speaks a subset of MySQL's SQL and none of Prisma's assumptions about migrations, transactions, or types hold. The pattern that actually works in production is to keep Prisma for your transactional Postgres or MySQL database and add a ClickHouse-native TypeScript layer for analytics. That's the setup this post walks through, with both clients living in the same service.

If you want to skip ahead and get a typed ClickHouse client running next to your existing Prisma setup, the [hypequery quick start](/docs/quick-start) takes about five minutes. For the broader landscape of ORM-style options, see the [ClickHouse ORM guide](/clickhouse-orm).

## Why there's no Prisma connector for ClickHouse

This isn't Prisma being slow to ship a driver. It's a genuine mismatch between what an ORM models and what ClickHouse is.

Prisma's data model is built around row-level transactional entities: a `User` has many `Orders`, you update one row inside a transaction, foreign keys enforce integrity, and `prisma migrate` evolves the schema safely. That model maps cleanly onto Postgres and MySQL because those databases are built for exactly that workload.

ClickHouse is a columnar, append-first analytical database. There are no enforced foreign keys. Transactions are limited and not the unit of work. Single-row `UPDATE` and `DELETE` are asynchronous mutations you're meant to use sparingly. Table engines like `ReplacingMergeTree` and `AggregatingMergeTree` change what a "row" even means at read time. An ORM's core abstractions — entity identity, relations, unit-of-work updates — don't have anything to attach to.

So a hypothetical Prisma ClickHouse connector wouldn't just need a new wire protocol. It would need a different data model, which is why the issues have sat open since 2022. The same reasoning applies across the ORM ecosystem — we've written up the general case in [Does ClickHouse have an ORM?](/blog/does-clickhouse-have-an-orm)

## The MySQL-compat-port workaround (and why it breaks)

ClickHouse exposes a MySQL wire-protocol interface on port 9004. Since Prisma has a MySQL provider, you can technically point it there:

```
# .env — this connects, but don't ship it
DATABASE_URL="mysql://default:password@clickhouse-host:9004/analytics"
```

`prisma db pull` may even introspect some tables. Then it falls apart, for three concrete reasons:

**1. ClickHouse implements a subset of MySQL's SQL.** The compatibility port translates the wire protocol, not the full dialect. Prisma's query engine generates MySQL SQL that assumes MySQL semantics — `information_schema` details, transaction statements, locking, `AUTO_INCREMENT`, specific `INSERT ... ON DUPLICATE KEY` behavior. ClickHouse rejects or silently reinterprets much of it. Queries that work in dev fail in odd ways under real use.

**2. ClickHouse-specific types don't map.** ClickHouse tables in the wild use `Array(String)`, `Map(String, String)`, `LowCardinality(String)`, `AggregateFunction(uniq, UInt64)`, `Enum8`, nested tuples. None of these exist in Prisma's schema language. Introspection either mangles them into strings or fails outright, and there's no way to write a `schema.prisma` that round-trips them. `UInt64` alone is a problem: it exceeds JavaScript's safe integer range and comes back as a string, which Prisma's MySQL type mapping doesn't expect.

**3. You lose all ClickHouse semantics.** Even when a query happens to execute, you can't express the things you moved to ClickHouse for: `FINAL` on a `ReplacingMergeTree`, `LIMIT BY` for top-N-per-group, `PREWHERE`, `argMax`, `uniq`, quantiles, array joins, materialized view targets. Prisma's query API has no vocabulary for any of it, and `prisma migrate` will happily try to run DDL that has no meaning for MergeTree engines.

The workaround demos well and fails in production. Treat port 9004 as what it is — a compatibility shim for MySQL clients like BI tools — not a foundation for an application data layer. There's a fuller breakdown on the [Prisma + ClickHouse page](/prisma-clickhouse).

## To be clear: Prisma is excellent at its actual job

None of this is a knock on Prisma. For transactional workloads on Postgres or MySQL — users, accounts, subscriptions, billing state — Prisma's typed client, migration workflow, and relation handling are best in class. If your app has an OLTP database, there's no reason to rip Prisma out.

The mistake is asking one tool to cover two fundamentally different databases. The fix is not replacing Prisma; it's pairing it with something ClickHouse-native.

## The pattern teams actually use: Prisma for OLTP, ClickHouse-native for analytics

In practice, services that use both databases run two clients side by side. Prisma owns the transactional schema. A ClickHouse-native layer — hypequery generates its types from your live ClickHouse schema with `npx hypequery generate` — owns analytics. Here's what that looks like in one service:

```ts
// src/clients.ts
import { PrismaClient } from '@prisma/client';
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

// OLTP: Postgres via Prisma
export const prisma = new PrismaClient();

// Analytics: ClickHouse via hypequery
export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

And a route that uses each database for what it's good at — Prisma for the account row, hypequery for the aggregation over millions of events:

```ts
// src/routes/account-overview.ts
import { prisma, db } from '../clients.js';

const thirtyDaysAgo = () =>
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

export async function getAccountOverview(tenantId: number) {
  // Transactional read: one row, relations, Prisma's home turf
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: tenantId },
    include: { subscription: true },
  });

  // Analytical read: aggregate 30 days of events in ClickHouse
  const usage = await db
    .table('events')
    .select(['event_type'])
    .count('id', 'event_count')
    .countDistinct('user_id', 'unique_users')
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', thirtyDaysAgo())
    .groupBy('event_type')
    .orderBy('event_count', 'DESC')
    .execute();

  return { account, usage };
}
```

Both clients are fully typed. Prisma's types come from `schema.prisma`; hypequery's come from introspecting your actual ClickHouse tables, so `UInt64` columns are typed as `string` and `Nullable(T)` as `T | null` — the values ClickHouse really returns at runtime, not an idealized mapping. That runtime-honesty matters more than it sounds; we've written about why in [the ClickHouse TypeScript type problem](/blog/clickhouse-typescript-type-problem).

The two schemas evolve independently, which is what you want: `prisma migrate` for the OLTP side, your ClickHouse DDL workflow plus `hypequery generate` for the analytics side. Nothing drifts silently, because the analytics types are regenerated from the live database.

## Where the analytics side goes beyond a query builder

If you stop at the snippet above you already have a workable split. But ClickHouse-side query logic tends to grow the same way Prisma models do — the same revenue definition gets copy-pasted into five endpoints, each with slightly different filters. That's the point where hypequery's dataset layer earns its keep: define dimensions, measures, and tenant isolation once in TypeScript, and reuse them across queries and HTTP routes.

```ts
import { dataset, dimension, measure } from '@hypequery/datasets';

const Events = dataset('events', {
  source: 'events',
  tenantKey: 'tenant_id',   // enforced on every query
  timeKey: 'created_at',
  dimensions: {
    event_type: dimension.string(),
  },
  measures: {
    eventCount: measure.count('id'),
    uniqueUsers: measure.countDistinct('user_id'),
  },
});
```

The `tenantKey` line is worth pausing on: it means a query that's missing a tenant filter is rejected before SQL executes, which is exactly the kind of guardrail Prisma users are used to having on the OLTP side. If you're serving analytics to customers in a multi-tenant product, this is covered in depth on the [multi-tenant analytics page](/clickhouse-multi-tenant-analytics).

## Decision summary

| Question | Answer |
|---|---|
| Does Prisma support ClickHouse? | No — no connector, issues open since 2022 |
| Does the MySQL port 9004 trick work? | Connects, but breaks on SQL subset, ClickHouse types, and semantics |
| Should you replace Prisma? | No — keep it for Postgres/MySQL OLTP |
| What handles ClickHouse? | A ClickHouse-native typed layer alongside Prisma |
| Do the two clients conflict? | No — separate schemas, separate migration workflows, one service |

If you're evaluating hypequery specifically against what Prisma gives you on the OLTP side — generated types, a fluent client, guardrails — the [hypequery vs Prisma comparison](/compare/hypequery-vs-prisma) maps each Prisma feature to its analytics-side equivalent honestly, including the places where a query builder deliberately isn't an ORM.

## Where to go from here

- [Quick start](/docs/quick-start) — add a typed ClickHouse client next to your Prisma setup in ~5 minutes
- [Prisma + ClickHouse](/prisma-clickhouse) — the full breakdown of the workarounds and the coexistence pattern
- [hypequery vs Prisma](/compare/hypequery-vs-prisma) — feature-by-feature comparison for the analytics side
- [ClickHouse ORM guide](/clickhouse-orm) — the wider landscape: why no true ORM exists and what to use instead
