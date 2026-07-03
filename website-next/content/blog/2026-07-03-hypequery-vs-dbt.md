---
title: "hypequery vs dbt: Transformation Layer or Application Layer?"
description: "dbt transforms data inside ClickHouse on a schedule. hypequery serves ClickHouse data to applications at request time. Here is how the two fit together — and when one replaces the other."
seoTitle: "hypequery vs dbt for ClickHouse — Which Layer Do You Need?"
seoDescription: "dbt models data inside ClickHouse. hypequery gives TypeScript apps typed queries and APIs on top of it. Compare both and see when you need one, the other, or both."
pubDate: 2026-07-03
heroImage: ""
slug: hypequery-vs-dbt
status: published
---

dbt and hypequery both sit on top of ClickHouse, both live in version control, and both exist so analytics logic doesn't end up as untracked SQL strings scattered across the codebase. That's about where the similarity ends — they run at different times, in different places, for different people.

dbt is a **transformation layer**: it runs SQL on a schedule inside ClickHouse and materialises the results as tables and views. hypequery is an **application layer**: it runs typed queries from your TypeScript code at request time and exposes them as APIs and React hooks.

Teams end up comparing them because both show up when you search "analytics layer on ClickHouse." This page separates the two jobs so you can figure out which one your stack actually needs — or whether it's both.

## What dbt does

dbt compiles SQL `SELECT` statements into ClickHouse-compatible SQL, runs them via the [dbt-clickhouse adapter](https://github.com/ClickHouse/dbt-clickhouse), and materialises the results as tables or views. Its strengths:

- Versioned, documented, testable SQL transformations
- Dependency ordering between models and incremental loads
- A workflow data teams already know from the warehouse world

Its relationship with ClickHouse works, but it's not seamless: no transactions, append-optimised storage, and MergeTree engine semantics mean some dbt patterns that are clean on Postgres or Snowflake need extra care here.

The important part: dbt runs on a **schedule or trigger**. It's not in the request path. It can't answer a user's dashboard filter or a tenant-scoped API call — that was never the job.

## What hypequery does

hypequery handles the request path instead. Your application needs to query ClickHouse in response to user actions, with runtime parameters, and it needs the results typed correctly:

- **Generated types** from your live ClickHouse schema — including the tables dbt materialises — with correct runtime mappings (`DateTime` → string, `UInt64` → string, `Nullable` → `T | null`)
- **A composable query builder** for filters, date ranges, aggregations, and tenant scoping decided at runtime
- **Typed REST endpoints** via `@hypequery/serve`, with input validation and generated OpenAPI docs
- **React hooks** that consume the same typed contract in dashboards

## The honest comparison

| | dbt | hypequery |
|---|---|---|
| Job | Transform data inside ClickHouse | Query and serve data to applications |
| Runs | On a schedule (`dbt run`) | At request time, in your app |
| Language | SQL + Jinja | TypeScript |
| Consumers | Analysts, BI tools, downstream models | Product code, APIs, React components |
| Type safety | Data tests on model output | Compile-time types generated from schema |
| Schema role | Defines and materialises tables | Introspects whatever exists |
| In the request path | No | Yes |

## Complementary more than competitive

The most common production setup uses both, with a clean handoff between them:

1. Raw events land in ClickHouse
2. dbt models them into clean analytics tables on a schedule
3. hypequery introspects those tables, generates types, and serves them to the application as typed queries and endpoints

Because hypequery generates types from the live schema, a dbt model change followed by a re-run of `generate` immediately surfaces any breakage in application code — at compile time, not in production. That's exactly the drift problem teams run into when the two layers are wired together by hand.

For a deeper treatment of where the transformation boundary should sit, read [TypeScript vs dbt for ClickHouse](/blog/typescript-vs-dbt-clickhouse).

## When dbt alone is enough

- Your ClickHouse consumers are analysts and BI tools, not application code
- Nothing queries ClickHouse at request time
- Your team is SQL-first and the output of analytics is reports, not product features

## When hypequery alone is enough

- Your transformations are simple enough for ClickHouse materialized views to handle
- The main consumer of ClickHouse is your TypeScript application
- Maintaining a separate transformation project would be overhead for a handful of tables that exist only to feed application APIs

## When you want both

- Raw event volumes need real modelling before they are queryable
- A data team owns transformation logic while product engineers own application features
- You want typed, compile-time-checked application access to the tables dbt produces

## Getting started with hypequery

The [quick start](/docs/quick-start) covers pointing hypequery at your ClickHouse — including dbt-materialised tables — generating types, and serving your first typed endpoint. The [ClickHouse TypeScript](/clickhouse-typescript) guide covers the broader workflow.
