---
title: "Query Builder vs ORM: What's the Difference for ClickHouse?"
description: "ORMs manage entities, relations, and migrations for transactional databases. Query builders construct typed SQL. Here's why that distinction matters for ClickHouse, and where hypequery deliberately sits."
seoTitle: "Query Builder vs ORM: What's the Difference for ClickHouse?"
seoDescription: "Query builder vs ORM explained: ORMs map rows to entities and manage their lifecycle; query builders construct typed SQL. Learn why analytical databases like ClickHouse favor query builders."
pubDate: 2026-06-10
heroImage: ""
slug: query-builder-vs-orm-clickhouse
status: published
tags:
  - ClickHouse
  - TypeScript
---

**Short answer:** an ORM maps database rows to objects in your language and manages their whole lifecycle — identity, change tracking, relations, migrations. A query builder does one narrower job: it constructs SQL programmatically, with types checking your column names, filters, and result shapes. ORMs earn their complexity on transactional (OLTP) databases where you load an entity, mutate it, and save it back. ClickHouse has no such workflow — it's columnar, append-heavy, and aggregation-first — so for ClickHouse you want a query builder, not an ORM.

That's why the established TypeScript ORMs never grew ClickHouse support, and why hypequery is deliberately a [typed query builder](/clickhouse-query-builder) plus schema codegen plus a semantic layer — not an ORM. If you want to see what that looks like against your own schema, the [quick start](/docs/quick-start) gets you to generated types and a first query in a few minutes.

The rest of this post defines both terms precisely, shows the code, and explains why the distinction is architectural rather than a matter of taste.

## What an ORM actually does

"Object-Relational Mapper" undersells it. A full ORM — Hibernate, Django ORM, Prisma, TypeORM — does four distinct jobs:

1. **Mapping.** Each table becomes a class or model; each row becomes an object instance. `orders` → `Order`, with typed fields.
2. **Identity and unit of work.** The ORM tracks which objects you've loaded and which fields you've changed. When you save, it computes the minimal `UPDATE` statements and issues them, often inside a transaction. Load the same row twice and many ORMs hand you the same object (an identity map).
3. **Relations.** You declare that an `Order` belongs to a `Customer` and has many `OrderItems`, then traverse those relations in code. The ORM turns traversal into joins or lazy-loaded queries.
4. **Migrations.** The model definitions are the source of truth for schema; the ORM diffs them against the database and generates `ALTER TABLE` migrations.

A typical ORM workflow looks like this (TypeORM-style, against Postgres):

```ts
// Load an entity with its relations
const order = await orderRepository.findOne({
  where: { id: 42 },
  relations: { customer: true, items: true },
});

// Mutate the object; the ORM tracks the change
order.status = 'shipped';

// Unit of work: the ORM issues UPDATE orders SET status = ... WHERE id = 42
await orderRepository.save(order);
```

This is a genuinely good abstraction *for OLTP*: single-row reads by primary key, small transactional writes, normalized tables connected by foreign keys. The ORM's machinery — identity, dirty checking, cascading saves — maps directly onto how a transactional application manipulates data.

## What a query builder does

A query builder skips all four of those jobs except a slice of the first. It doesn't manage objects, track changes, or own your schema. It gives you a fluent, typed API for constructing SQL, executing it, and typing the results.

Here's the SQL for a daily revenue rollup:

```sql
SELECT
  toStartOfDay(created_at) AS created_at,
  region,
  sum(total) AS revenue,
  count(DISTINCT user_id) AS buyers
FROM orders
WHERE status = 'completed'
  AND created_at >= '2026-06-01 00:00:00'
GROUP BY created_at, region
ORDER BY region ASC
```

And the equivalent with hypequery's typed builder:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const revenueByDay = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .countDistinct('user_id', 'buyers')
  .where('status', 'eq', 'completed')
  .where('created_at', 'gte', '2026-06-01 00:00:00')
  .groupByTimeInterval('created_at', '1 day')
  .groupBy('region')
  .orderBy('region', 'ASC')
  .execute();
```

The value is different in kind from an ORM's. Nothing here is an "entity." No object is tracked. What you get instead:

- **Compile-time column checking.** `'orders'`, `'total'`, `'status'` are all validated against your generated schema types. Rename a column in ClickHouse, regenerate, and every stale reference fails to compile.
- **Typed results.** The result rows are typed from the query itself — including ClickHouse's runtime quirks, like `UInt64` and `DateTime` coming back as strings and `Nullable(T)` becoming `T | null`.
- **Safe parameterization.** Filter values are bound as parameters, not string-concatenated.
- **Composability.** You can build a query up conditionally — add a `.where()` per user-supplied filter, a tenant clause per request — which is exactly what runtime analytics endpoints need.

Kysely is the best-known general-purpose TypeScript query builder, and it's the closest neighbor to what hypequery's builder does — the difference is that Kysely targets transactional dialects while hypequery is ClickHouse-native, with `LIMIT BY`, `FINAL`, array joins, and time-bucketing as first-class methods. There's a detailed breakdown in [hypequery vs Kysely](/compare/hypequery-vs-kysely).

## Why analytical databases favor query builders

The ORM/query-builder split isn't primarily about developer preference. It falls out of the database's design. Three properties of ClickHouse (and columnar analytical stores generally) make the ORM abstraction a poor fit:

**1. No transactional entity updates.** The ORM's centerpiece — load object, mutate, save inside a transaction — assumes cheap single-row `UPDATE`s and ACID transactions. ClickHouse has neither in the OLTP sense: it's optimized for bulk appends, and mutations are heavyweight background operations, not a request-path primitive. An identity map and unit of work have nothing to manage. The dedup patterns you actually use — `ReplacingMergeTree` with `FINAL`, or an `argMax` query — are query-time concerns, which is builder territory (`.final()`, `.argMax()`), not entity territory.

**2. Aggregation-first access patterns.** ORMs are built around fetching entities: `find`, `findOne`, `save`. Analytics queries are built around collapsing millions of rows into a few: sums, distinct counts, percentiles, time buckets. An ORM has no natural vocabulary for

```ts
const latency = await db
  .table('events')
  .quantile('duration_ms', 0.95, 'p95')
  .groupByTimeInterval('created_at', '1 hour')
  .orderBy('created_at', 'ASC')
  .execute();
```

whereas that's a query builder's home turf. ORMs treat aggregation as an escape hatch (raw SQL, `queryRaw`); on ClickHouse, aggregation *is* the workload.

**3. Denormalized tables, not relation graphs.** ORMs shine at traversing normalized schemas via foreign keys. ClickHouse best practice pushes the opposite way: wide, denormalized tables so queries scan one table instead of joining five. There's no foreign-key graph for an ORM to model. Joins exist and hypequery supports them (`.leftJoin()`, `.innerJoin()`), but they're a query decision, not a schema-level relationship an ORM should own.

This is also the honest answer to "why is there no Prisma for ClickHouse": the entity model at the heart of Prisma, TypeORM, and Drizzle's relational layer assumes row-level transactional semantics that ClickHouse intentionally doesn't have. Prisma has no native ClickHouse connector, and the MySQL-wire workaround breaks on ClickHouse-specific syntax — the practical details are in [using Prisma with ClickHouse](/prisma-clickhouse).

## Where hypequery sits — and what it deliberately isn't

hypequery is three layers, none of which is an ORM:

**Typed query builder** (`@hypequery/clickhouse`) — everything above, ClickHouse-native.

**Schema codegen** — this is the part people mistake for ORM behavior, so it's worth being precise. An ORM's models *define* the schema and generate migrations toward it. hypequery goes the other direction: your ClickHouse tables are the source of truth, and the CLI introspects them to generate types.

```bash
npx hypequery generate
# introspects your live ClickHouse schema → ./generated/schema.ts
```

You get the compile-time safety ORMs are loved for, without hypequery claiming ownership of DDL. Migrations, table engines, sort keys, TTLs — those stay in your hands (or your migration tool's), because getting `ORDER BY` and engine choices right in ClickHouse is a performance decision no codegen tool should make for you.

**Semantic layer** (`@hypequery/datasets`) — the layer ORMs don't have at all. Instead of entities, you define datasets with dimensions and measures, and derive governed metrics from them:

```ts
import { dataset, dimension, measure, eq } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('total'),
    completedRevenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
  },
});
```

An `Order` entity models *one row's* lifecycle. A dataset models *how a table aggregates*: which columns are safe to group by, which measures mean what, which key isolates tenants. For analytics, the second abstraction is the one that pays rent. More on this in the [ClickHouse semantic layer](/clickhouse-semantic-layer) guide.

To be explicit about what's missing, on purpose: hypequery has **no migrations engine, no identity map, no change tracking, no `save()`**. If a library advertised those features for ClickHouse, it would be promising a workflow the database doesn't support.

## Side by side

| | Full ORM (Prisma, TypeORM) | Query builder (Kysely, hypequery) |
|---|---|---|
| **Core abstraction** | Entities with lifecycle | Typed SQL construction |
| **Write model** | Load → mutate → save, transactional | Bulk inserts, append-first |
| **Read model** | Fetch objects by key/relations | Aggregate millions of rows |
| **Schema ownership** | Models generate migrations | Database is source of truth; types generated from it |
| **Relations** | Declared, traversed, lazy/eager loaded | Explicit joins per query |
| **Natural database** | Postgres, MySQL (OLTP) | ClickHouse (OLAP), any SQL for Kysely |
| **ClickHouse support** | None native | hypequery: native |

## When you actually want an ORM

None of this means ORMs are the wrong tool generally. If you're building the transactional side of an application — users, subscriptions, orders being created and updated — an ORM on Postgres or MySQL is a fine, often excellent choice. The common production shape is both at once: Prisma or Drizzle owning the OLTP database, and a ClickHouse-native layer owning analytics, with events flowing from one to the other. Your `Order` entity lives in Prisma; your "revenue by region by day for this tenant" query lives in hypequery. Neither tool should try to do the other's job.

The mistake to avoid is dragging the ORM abstraction across the boundary — forcing entity semantics onto a columnar store, or hand-writing untyped SQL strings on the analytics side because "there's no ORM for ClickHouse." The first fights the database; the second throws away type safety you can have for free.

## Where to go from here

- [ClickHouse ORM: what exists and what to use instead](/clickhouse-orm) — the full landscape of ORM-ish options for ClickHouse
- [Does ClickHouse have an ORM?](/blog/does-clickhouse-have-an-orm) — the direct answer to the adjacent question
- [hypequery vs Kysely](/compare/hypequery-vs-kysely) — if you're weighing general-purpose query builders
- [Quick start](/docs/quick-start) — generate types from your schema and run a typed query in minutes
