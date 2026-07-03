---
title: "hypequery vs Moose (MooseStack): Framework or Library for ClickHouse?"
description: "Moose is a full-stack framework for analytical backends. hypequery is a typed query layer for the ClickHouse you already run. Here is how to choose between them."
seoTitle: "hypequery vs Moose (MooseStack) — ClickHouse TypeScript Comparison"
seoDescription: "Moose (MooseStack) manages ClickHouse schema, streaming, and workflows as a framework. hypequery adds typed queries and APIs to your existing ClickHouse. Compare both."
pubDate: 2026-07-03
heroImage: ""
slug: hypequery-vs-moose
status: published
---

Moose (also called MooseStack, from 514 Labs) and hypequery are the two most direct answers to the same question: how should a TypeScript team build on ClickHouse without hand-writing types and boilerplate?

They disagree on one fundamental point, and it's worth getting clear on it before anything else. Moose is a **framework** — it wants to define your ClickHouse schema in code, run your local dev infrastructure, and manage streaming and orchestration around the database. hypequery is a **library** — it treats the ClickHouse you already run as the source of truth and adds a typed query and serving layer inside your existing application.

Almost every tradeoff below falls out of that one difference.

## What Moose does

MooseStack is an open-source developer framework for real-time analytical backends in TypeScript or Python. It's organised into modules:

- **Moose OLAP** — declare ClickHouse tables, materialized views, and migrations as typed code. Schema lives in your repo and is pushed to ClickHouse, in the same direction Drizzle or Prisma push schema to Postgres.
- **Moose Streaming** — ingestion buffers and streaming transformations backed by Kafka or Redpanda.
- **Moose Workflows** — ETL pipelines and scheduled tasks backed by Temporal.
- **Moose APIs** — typed ingestion and query endpoints served from your declared models.
- **Moose Dev** — a local dev server that spins up the whole stack with hot reload, plus an MCP interface so AI agents can operate the dev environment.

514 Labs also runs Boreal, a managed hosting platform that deploys MooseStack projects with preview environments and managed migrations.

If you're starting an analytical backend from scratch — ingestion, storage, transformation, APIs, all of it — Moose gives you one coherent, code-first way to build the whole thing.

## What hypequery does

hypequery starts from the opposite assumption: ClickHouse already exists in your stack, with its own ingestion pipelines and its own migration story already sorted. What's missing is the typed layer between ClickHouse and your TypeScript application.

- **Schema generation** — introspect your live ClickHouse database and generate TypeScript types that match real runtime behaviour (`DateTime` as string, `UInt64` as string, `Nullable` as `T | null`).
- **Query builder** — composable, fully typed analytics queries with ClickHouse-aware helpers and raw SQL escape hatches.
- **Typed serving** — `@hypequery/serve` turns query definitions into REST endpoints with input validation, typed responses, and generated OpenAPI docs.
- **React hooks** — consume the same typed query contracts from dashboards and product UI.

There's no dev runtime, no project scaffold, and no infrastructure footprint. It's an npm dependency in the app you already have.

## The core difference: who owns the schema

Moose is code-first: you declare tables in TypeScript and Moose migrates ClickHouse to match. That's powerful when the analytical backend is greenfield and the Moose project *is* the system of record for schema.

hypequery is database-first: however your ClickHouse schema is managed — SQL migrations, Terraform, dbt, a data team with strong opinions — hypequery introspects it and generates types from what actually exists. That fits teams where ClickHouse predates the application layer, or where schema ownership sits outside the TypeScript codebase.

Neither direction is wrong. The question is whether your TypeScript project should own ClickHouse or consume it.

## The honest comparison

| | Moose (MooseStack) | hypequery |
|---|---|---|
| Model | Framework — owns schema, dev runtime, infra lifecycle | Library — added to an existing app |
| Schema | Declared in code, migrated to ClickHouse | Introspected from live ClickHouse |
| Streaming ingest | Built in (Kafka/Redpanda) | Not included — bring your own pipeline |
| Orchestration | Built in (Temporal) | Not included |
| Typed queries | Yes | Yes |
| Typed API endpoints | Yes (ingest + query APIs) | Yes (`@hypequery/serve` with OpenAPI) |
| React integration | Bring your own | Typed hooks on the same query contract |
| Local dev | `moose dev` runtime spins up the stack | Nothing extra — it is just your app |
| Languages | TypeScript and Python | TypeScript |
| Adoption cost | New project structure and runtime | `npm install` into existing code |
| Open source | Yes (managed hosting via Boreal) | Yes |

## When to choose Moose

- You're building an analytical backend **from scratch** and want one framework for ingestion, schema, transformation, and APIs
- You want streaming ingestion (Redpanda/Kafka) and workflow orchestration (Temporal) managed by the same tool that manages your tables
- You want schema migrations owned by your TypeScript (or Python) codebase
- The idea of an agent-operable dev runtime appeals to you, and you're fine adopting Moose's project structure
- A managed deployment path (Boreal) is attractive

## When to choose hypequery

- ClickHouse **already exists** in your stack, with its own ingestion and migration story
- You want typed queries, typed REST endpoints, and React hooks inside an application you already have
- You don't want a framework runtime, a project scaffold, or new infrastructure dependencies in your dev loop
- Schema ownership sits with a data team or another tool, and your TypeScript layer should follow that, not fight it
- You want the smallest possible step from "untyped ClickHouse calls" to "typed analytics layer"

## Can you use them together?

Not really, and it's worth being direct about that. Both tools want to be the typed query and API layer between ClickHouse and your application, so running both just means two competing sources of truth for the same job. If Moose manages your ClickHouse, use Moose's query APIs. If ClickHouse is managed elsewhere, hypequery is the lighter, more natural fit.

## Getting started with hypequery

If the library model fits, the [quick start](/docs/quick-start) takes you from schema introspection to a typed query and a served endpoint in a few minutes. For the broader picture of the workflow, read the [ClickHouse TypeScript](/clickhouse-typescript) guide, or see how the [query builder](/clickhouse-query-builder) handles filters, joins, and aggregations with generated types.
