---
title: "hypequery vs Prisma: Why Prisma Does Not Work for ClickHouse"
description: "Prisma does not support ClickHouse. If you want a schema-first TypeScript experience for ClickHouse analytics, hypequery is the alternative — built for the ClickHouse data model."
seoTitle: "hypequery vs Prisma for ClickHouse — TypeScript Analytics Alternative"
seoDescription: "Prisma does not support ClickHouse. hypequery gives you the schema-first, TypeScript-first experience for ClickHouse analytics — without the wrong abstractions."
pubDate: 2026-04-25
heroImage: ""
slug: hypequery-vs-prisma
status: published
---

Prisma is the dominant TypeScript ORM for Postgres and MySQL. Its model is clean and well understood: define your schema, run a migration, get a typed client. The developer experience is polished and the ecosystem is large.

ClickHouse is not in Prisma's supported database list. Prisma is built around transactional relational workflows, which is a poor fit for a columnar analytics database like ClickHouse.

## Why Prisma and ClickHouse do not fit

Prisma's architecture assumes a transactional relational database. It models:

- Tables with primary keys
- Foreign key relationships
- Transactions and row-level locking
- Standard SQL mutations (INSERT, UPDATE, DELETE)

ClickHouse is none of these things. It is a columnar store optimised for append and aggregation. It does not have the same transaction model. UPDATE and DELETE exist but are handled very differently. Joins work differently, and the performance model for queries is inverted compared to Postgres — full table scans are fast, row-level access is slow.

Forcing Prisma's mental model onto ClickHouse would produce something that looks familiar but behaves incorrectly at scale.

## What you actually want when you search for "Prisma for ClickHouse"

When developers search for Prisma for ClickHouse, they are usually looking for two things:

1. **Schema-driven types** — types that come from the database definition, not from hand-written interfaces that drift
2. **A structured query API** — something typed and composable, not raw SQL strings

Both of these are available in hypequery, built for the ClickHouse data model.

## How hypequery compares

**Schema types** — hypequery generates TypeScript types from your live ClickHouse schema using `@hypequery/cli generate`. Like Prisma's generated client types, these reflect the actual database rather than hand-maintained interfaces. Unlike Prisma, the types account for ClickHouse-specific runtime behaviour — DateTime as string, UInt64 as string, Nullable as T | null.

**Query builder** — hypequery's fluent query builder is typed from the generated schema. Table names, column names, and return types all autocomplete and type-check. It is designed around analytical ClickHouse queries rather than transactional relational CRUD, and it leaves room for raw SQL when a ClickHouse-specific clause needs exact control.

**Serving** — Prisma gives you a database client. hypequery goes further with @hypequery/serve, which turns your query definitions into typed REST endpoints with OpenAPI docs. This is the layer analytics teams need that pure ORMs do not provide.

**Migrations** — Prisma's migration system is one of its strongest features. hypequery migrations are in development and will account for ClickHouse-specific ALTER TABLE constraints, ON CLUSTER DDL for distributed setups, and automatic TypeScript type regeneration. [Schema generation](/clickhouse-schema) is available today.

## The Postgres + ClickHouse mixed setup

Many teams run Postgres for application data and ClickHouse for analytics. This is a common and well-justified architecture. In this setup:

- Use Prisma for Postgres — it is the right tool
- Use hypequery for ClickHouse — it is built for the analytics workload

They are not competitors in this setup. Prisma handles your users, orders, and products. hypequery handles your events, metrics, and reporting.

## Getting started

If you are evaluating ClickHouse for an analytics use case and looking for a Prisma-equivalent TypeScript experience, the [quick start](/docs/quick-start) covers schema generation and your first typed query.

For the broader comparison of TypeScript options for ClickHouse, read the [ClickHouse TypeScript](/clickhouse-typescript) pillar page and the [ClickHouse query builders](/blog/clickhouse-query-builder-typescript) comparison.
