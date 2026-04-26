---
title: "hypequery vs Drizzle: There Is No Drizzle for ClickHouse"
description: "Drizzle ORM does not support ClickHouse. If you are looking for a Drizzle-style TypeScript experience for ClickHouse analytics, this explains what hypequery offers instead."
seoTitle: "hypequery vs Drizzle ORM for ClickHouse — TypeScript Analytics"
seoDescription: "Drizzle ORM does not support ClickHouse. hypequery is the TypeScript-first alternative — schema generation, composable queries, and typed HTTP APIs built specifically for ClickHouse."
pubDate: 2026-04-25
heroImage: ""
slug: hypequery-vs-drizzle
status: published
---

Drizzle is one of the most popular TypeScript ORM/query builder choices right now — and for good reason. It is lightweight, fully typed, schema-driven, and integrates well with the modern TypeScript ecosystem. If you are on Postgres, MySQL, or SQLite, it is a serious option.

ClickHouse is not on that list.

Drizzle does not list ClickHouse in its supported databases. If you are building an analytics product on ClickHouse and looking for a Drizzle-equivalent TypeScript experience, you are looking for something else.

That something else is hypequery.

## What Drizzle gets right

Drizzle's core value proposition is schema-first type safety. You define your schema in TypeScript, and the type system enforces it everywhere — query inputs, return types, join shapes. You do not hand-write response interfaces; you derive them from the schema definition.

For the Postgres ecosystem this works excellently. The schema matches what the database returns. The types are correct. Refactors are safe.

## Why ClickHouse changes the picture

ClickHouse is a columnar analytics database. Its data model is fundamentally different from Postgres:

- No foreign keys or joins in the relational sense
- Append-optimised, not transaction-optimised
- Different SQL dialect — PREWHERE, ARRAY JOIN, materialized views, dictionaries
- Runtime type behaviour that differs from standard SQL — DateTime returns as a formatted string, UInt64 returns as a string to avoid precision loss, Nullable columns behave differently

An ORM built for Postgres, even a lightweight one like Drizzle, is built around the relational model. ClickHouse does not fit that model — and forcing it produces awkward code, missing features, and type mappings that are wrong at runtime.

## What hypequery offers instead

hypequery is the TypeScript-first ClickHouse query layer built for the ClickHouse data model rather than adapted from a relational one.

**Schema generation** — like Drizzle's schema approach, but pulled from your live ClickHouse database rather than defined in TypeScript and pushed to the database. This matters because ClickHouse's runtime types (DateTime, UInt64, Nullable) need to be mapped correctly to TypeScript — and the only reliable way to do that is from the live schema.

**Composable query builder** — a fluent query builder that is built around ClickHouse workloads, with typed filters and query composition in the common case plus raw SQL escape hatches when you need database-specific clauses.

**HTTP serving** — @hypequery/serve turns your query definitions into typed REST endpoints with OpenAPI docs. This is the step that most analytics teams reach eventually and have to build themselves.

**React hooks** — @hypequery/react wraps your typed endpoints as React hooks for dashboard components.

## The honest comparison

If you want Drizzle for ClickHouse, you want hypequery. The core experience is similar — schema-driven types, a query builder, a TypeScript-first workflow. The implementation is different because the database is different.

If you are running Postgres alongside ClickHouse (common in mixed workloads), use Drizzle for Postgres and hypequery for ClickHouse. They are not competitors in that setup — they are the right tool for each database.

## Getting started

The quick start covers schema generation and your first typed ClickHouse query. If you are coming from Drizzle, the mental model transfers — schema first, then queries, then serving.

For the broader context on TypeScript options for ClickHouse, read the [ClickHouse query builders comparison](/blog/clickhouse-query-builder-typescript) and the [ClickHouse TypeScript](/clickhouse-typescript) pillar page.
