---
title: "TypeScript vs dbt for ClickHouse: Choosing the Right Analytics Layer"
description: "dbt and TypeScript solve overlapping but different problems on top of ClickHouse. Here's how to think about which one belongs in your stack — and when you need both."
seoTitle: "TypeScript vs dbt for ClickHouse Analytics — What to Use and When"
seoDescription: "dbt and TypeScript query builders both help you build on top of ClickHouse, but they solve different problems. This guide explains the trade-offs and when to use each."
pubDate: 2026-05-18
heroImage: ""
slug: typescript-vs-dbt-clickhouse
status: published
---

dbt and TypeScript are not natural competitors — but if you're building an analytics product on ClickHouse, you'll eventually have to decide how much work belongs in each layer. The answer isn't obvious, and it depends heavily on what you're actually building.

This post breaks down what each tool actually does on top of ClickHouse, where they overlap, where they don't, and how teams typically combine them.

## What dbt does

dbt (data build tool) is a transformation layer. You write SQL `SELECT` statements, dbt compiles them into ClickHouse-compatible SQL, runs them, and materialises the results as tables or views. It also handles dependency ordering between models, incremental loads, and test assertions on your data.

The core value proposition is **repeatability and documentation for SQL transformations**. dbt makes it easy to build a DAG of data transformations that multiple people can understand, run, and maintain. It's strong on:

- Defining and versioning your data models in SQL
- Running scheduled or triggered transformations
- Generating data documentation automatically
- Testing that your transformations produce expected shapes

dbt's relationship with ClickHouse is functional but imperfect. The [dbt-clickhouse adapter](https://github.com/ClickHouse/dbt-clickhouse) handles most common materialization patterns, but ClickHouse's data model — no transactions, append-optimised, MergeTree engine semantics — means some dbt patterns that work cleanly on Postgres don't translate directly.

## What TypeScript gives you

A TypeScript analytics layer — whether that's raw `@clickhouse/client`, a query builder like hypequery, or a custom abstraction — handles a different job: **query execution at runtime**.

Your application code needs to query ClickHouse in response to user requests. It needs typed results. It needs to pass user-provided parameters safely. It needs to compose queries based on runtime conditions (filters, date ranges, tenant IDs). None of this is what dbt is for — dbt runs on a schedule or trigger, not in response to an API call.

What a TypeScript query layer gives you:

- Type-safe query construction that catches mistakes at compile time
- Schema-derived types that match what ClickHouse actually returns at runtime
- Composable query logic that can respond to user input
- HTTP endpoints that expose your queries as a typed API

## Where they overlap: defining queries twice

The tension point is that both tools end up with representations of your ClickHouse tables. dbt has its schema definitions. Your TypeScript codebase has its types. When ClickHouse schema changes, both need updating — and they can drift independently.

This is the core problem a type-safe TypeScript layer solves: **generate types from the live schema** rather than maintaining them by hand. hypequery's CLI connects to your ClickHouse instance and generates TypeScript types from your real tables, including correct runtime type mappings for ClickHouse-specific types like `UInt64` (returned as string), `DateTime` (returned as formatted string), and `Nullable` variants.

```bash
npx hypequery init
# connects to ClickHouse, introspects schema, generates types
```

The generated types reflect the actual state of your database — not a manually-maintained approximation.

## A practical breakdown

**Use dbt when:**

- You're building and scheduling data transformations — moving data between tables, aggregating raw events into analytics tables, maintaining materialized views at scale
- You have a data engineering team that thinks in SQL and wants version control, CI, and documentation for their transformation logic
- You need to build a reliable data pipeline where transformations run on a schedule independently of your application

**Use a TypeScript query layer when:**

- You're building application features that query ClickHouse at runtime — dashboards, reports, analytics APIs
- You need user-parameterised queries: filter by date, tenant, region, and so on
- You're serving query results over HTTP to a frontend or other service
- You want compile-time safety on query construction and result shapes

**Use both when:**

This is the most common setup for product analytics:

- dbt handles the transformation pipeline: raw events → cleaned events → aggregated metrics tables
- TypeScript (hypequery) handles the application layer: queries against the dbt-produced tables, serving results to dashboards, exposing typed HTTP routes

The two tools are complementary. dbt produces the tables. hypequery queries them safely from your application.

```ts
// hypequery queries the tables that dbt built and maintains
const db = createQueryBuilder<IntrospectedSchema>({ /* connection */ });

const dailyRevenue = await db
  .table('fct_orders_daily')    // a dbt model
  .select(['date', 'region'])
  .where('date', 'gte', startDate)
  .sum('revenue', 'total_revenue')
  .groupBy(['date', 'region'])
  .orderBy('date', 'DESC')
  .execute();
// fully typed — date: string, region: string, total_revenue: string
```

## The TypeScript-only path

Not every team uses dbt. Many TypeScript teams handle their transformation logic directly — using ClickHouse materialized views, scheduled queries, or application-level aggregations instead of dbt models.

This works well when:

- The team is TypeScript-first and doesn't want a Python/SQL tool in the stack
- The transformation logic is simple enough to manage without dbt's DAG runner
- You want a single language and toolchain for both transformations and application queries

hypequery supports this path: you can express both your transformation queries and your application queries in TypeScript, with the same type-safe query builder.

## The dbt-only path (and why it falls short for application queries)

Some teams try to handle everything in dbt — pre-computing all possible query shapes as materialized views and exposing them via ClickHouse's HTTP interface. This can work for a small, fixed set of metrics.

It falls apart when:

- Users need to filter, slice, or parameterise queries dynamically
- The number of query shapes grows beyond what you can reasonably pre-compute
- You need to serve query results through a typed API with input validation

dbt doesn't do runtime query parameterisation. That's what your application layer is for.

## Summary

| | dbt | TypeScript (hypequery) |
|---|---|---|
| **Primary job** | Data transformation | Runtime query execution |
| **Runs when** | Scheduled / triggered | Per request |
| **Parameterised queries** | No | Yes |
| **Type-safe results** | No | Yes |
| **HTTP API** | No | Yes (via @hypequery/serve) |
| **ClickHouse runtime types** | N/A | Correct mappings generated |
| **Best for** | Data engineers | TypeScript application teams |

If you're choosing between them, you're probably asking the wrong question — most production analytics stacks use both. dbt owns the transformation pipeline; your TypeScript layer owns the application queries.

If your team is TypeScript-first and the transformation logic is manageable, you can skip dbt entirely and handle everything in TypeScript. If you have a data engineering team and a complex transformation DAG, dbt and hypequery complement each other cleanly.

---

**Related reading:**
- [hypequery vs @clickhouse/client: what you actually gain](/blog/hypequery-vs-clickhouse-client)
- [Building a real-time dashboard with ClickHouse and React](/blog/clickhouse-real-time-dashboard-react)
- [Type-safe schema management for ClickHouse](/blog/type-safe-schema-management-clickhouse)
