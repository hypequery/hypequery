---
title: "hypequery vs Drizzle: There Is No Drizzle for ClickHouse"
description: "Drizzle ORM does not support ClickHouse. If you are looking for a Drizzle-style TypeScript experience for ClickHouse analytics, this explains what hypequery offers instead."
seoTitle: "Drizzle ClickHouse: Does Drizzle ORM Support ClickHouse? (2026)"
seoDescription: "Drizzle ORM does not support ClickHouse. Keep Drizzle for Postgres or MySQL, and use a ClickHouse-native layer such as hypequery for typed analytics queries."
pubDate: 2026-04-25
updatedAt: 2026-11-14
heroImage: ""
slug: hypequery-vs-drizzle
status: published
---

**Short answer:** Drizzle does not support ClickHouse. Keep Drizzle for your PostgreSQL, MySQL, SQLite, SingleStore, MSSQL, or CockroachDB application data, and use a ClickHouse-native client or query layer for analytics. hypequery is one TypeScript-first option when you also need schema-generated types, shared metrics, tenant rules, HTTP endpoints, React hooks, or agent tools.

Drizzle is one of the most popular TypeScript ORM/query builder choices right now — and for good reason. It is lightweight, fully typed, schema-driven, and integrates well with the modern TypeScript ecosystem. If you are on one of the databases its docs list, it is a serious option.

ClickHouse is not on that list.

Drizzle does not list ClickHouse in its supported databases (rechecked 14 November 2026). If you are building an analytics product on ClickHouse and looking for a Drizzle-equivalent TypeScript experience, you need a ClickHouse-native option.

## What Drizzle gets right

Drizzle's core value proposition is schema-first type safety. You define your schema in TypeScript, and the type system enforces it everywhere — query inputs, return types, join shapes. You do not hand-write response interfaces; you derive them from the schema definition.

For the Postgres ecosystem this works excellently. The schema matches what the database returns. The types are correct. Refactors are safe.

## Why ClickHouse changes the picture

ClickHouse is a columnar analytics database. Its data model is fundamentally different from Postgres:

- No foreign keys; joins work, but analytics tables are usually denormalised
- Append-optimised, not transaction-optimised
- Different SQL dialect — PREWHERE, ARRAY JOIN, materialized views, dictionaries
- Runtime type behaviour that differs from standard SQL: DateTime returns as a formatted string, UInt64 can exceed JavaScript's safe integer range (hypequery asks ClickHouse to quote it as a string), and Nullable columns behave differently

An ORM built for Postgres, even a lightweight one like Drizzle, is built around the relational model. ClickHouse does not fit that model — and forcing it produces awkward code, missing features, and type mappings that are wrong at runtime.

## What hypequery offers instead

hypequery is the TypeScript-first ClickHouse query layer built for the ClickHouse data model rather than adapted from a relational one.

**Schema generation** — like Drizzle's schema approach, but pulled from your live ClickHouse database rather than defined in TypeScript and pushed to the database. This matters because ClickHouse's runtime types (DateTime, UInt64, Nullable) need to be mapped correctly to TypeScript — and the only reliable way to do that is from the live schema.

**Composable query builder** — a fluent query builder that is built around ClickHouse workloads, with typed filters and query composition in the common case plus raw SQL escape hatches when you need database-specific clauses.

**HTTP serving** — @hypequery/serve turns your query definitions into typed REST endpoints with OpenAPI docs. This is the step that most analytics teams reach eventually and have to build themselves.

**React hooks** — @hypequery/react wraps your typed endpoints as React hooks for dashboard components.

## The fact-based comparison

| Criterion | Drizzle | hypequery |
|---|---|---|
| Primary job | TypeScript ORM and query builder for relational application data | ClickHouse query builder and code-first analytics layer |
| Listed databases | PostgreSQL, MySQL, SQLite, SingleStore, MSSQL, and CockroachDB | ClickHouse |
| ClickHouse driver | Not listed | Native through `@clickhouse/client` |
| Schema source | TypeScript schema, or schema pulled with Drizzle Kit for supported dialects | Types generated from the live ClickHouse schema |
| ClickHouse runtime types | Not applicable | Maps types such as `DateTime`, `UInt64`, and `Nullable` to their runtime TypeScript shapes |
| Shared measures and dimensions | Not included | Datasets in `@hypequery/datasets` |
| Tenant-scoped analytics | Application code owns it | Dataset `tenantKey` plus trusted runtime context |
| HTTP, OpenAPI, and React | Not included | `@hypequery/serve` and `@hypequery/react` |
| Agent tools | Not included | Dataset and metric tools through `@hypequery/mcp` |

The tools are complementary in a common two-database architecture: Drizzle handles transactional data in Postgres or another supported relational database, while hypequery handles product analytics in ClickHouse.

## The honest comparison

If you want a Drizzle-like TypeScript workflow for ClickHouse, hypequery is one option. The core experience is similar — schema-driven types, a query builder, a TypeScript-first workflow. The implementation is different because the database is different.

If you are running Postgres alongside ClickHouse (common in mixed workloads), use Drizzle for Postgres and hypequery for ClickHouse. They are not competitors in that setup — they are the right tool for each database.

## Getting started

The quick start covers schema generation and your first typed ClickHouse query. If you are coming from Drizzle, the mental model transfers — schema first, then queries, then serving.

For the broader context on TypeScript options for ClickHouse, read the [ClickHouse query builders comparison](/clickhouse-query-builder) and the [ClickHouse TypeScript](/clickhouse-typescript) pillar page.

## Sources checked

- Drizzle: [supported databases and overview](https://orm.drizzle.team/docs/overview), [get started](https://orm.drizzle.team/docs/get-started), and [Drizzle Kit dialect configuration](https://orm.drizzle.team/docs/drizzle-config-file)
- hypequery: [schema generation](/docs/schemas), [query basics](/docs/query-building/basics), [datasets](/docs/datasets/overview), and [HTTP and OpenAPI](/docs/http-openapi)
