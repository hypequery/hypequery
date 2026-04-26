---
title: "hypequery vs Cube: Code-First vs Configuration-First Analytics"
description: "Cube is a semantic layer and analytics platform. hypequery is a lightweight TypeScript query layer. Here is when each is the right choice for ClickHouse."
seoTitle: "hypequery vs Cube for ClickHouse — Analytics Layer Comparison"
seoDescription: "Cube is a full semantic layer. hypequery is a lightweight TypeScript-first alternative. Compare both for ClickHouse analytics and find the right fit."
pubDate: 2026-04-25
heroImage: ""
slug: hypequery-vs-cube
status: published
---

Cube (formerly Cube.js) is a semantic layer platform: central metric definitions, multiple consumption surfaces, and access control around them. It supports ClickHouse and has a much broader analytics-platform scope than hypequery.

hypequery is not trying to be that category. It is a TypeScript-first ClickHouse query layer: schema generation, a composable query builder, typed HTTP APIs, and React hooks. The center of gravity is product code, not a separate analytics platform.

So this is less a feature checklist than a fit question. The tools solve adjacent problems for different team shapes.

## What Cube does well

Cube is designed for organisations that want a centralised metrics definition layer — a "metrics store" that multiple consumers (dashboards, APIs, spreadsheets, BI tools) all read from. Its strengths are:

- **Multi-framework consumption** — the same metric definition can be consumed by Tableau, Metabase, a custom React dashboard, and a REST API simultaneously
- **Caching and pre-aggregations** — Cube manages query caching and can pre-aggregate results for performance at scale
- **Access control** — row-level security and tenant isolation are handled in the Cube data model layer
- **No-code and low-code consumption** — non-engineers can query the semantic layer from BI tools without writing code

These are powerful features for data teams serving multiple internal and external consumers.

## Where Cube becomes a constraint

Cube is not a lightweight tool. Running Cube adds infrastructure — a Cube server, configuration management, and often a Redis cache. The configuration-first YAML/JavaScript schema can feel distant from the TypeScript codebase that engineers are working in day-to-day.

For product engineering teams building ClickHouse-powered features into their TypeScript application, Cube can feel like bringing a warehouse-scale tool to a product engineering problem. If you just need typed ClickHouse queries serving a dashboard and an API, Cube's setup cost is high relative to the problem size.

## Where hypequery fits

hypequery is optimised for product engineering teams building ClickHouse-backed features in TypeScript. The workflow is code-first:

1. Generate TypeScript types from your ClickHouse schema
2. Define analytics queries in TypeScript using the query builder
3. Serve those queries as typed REST endpoints with OpenAPI docs
4. Consume them in React dashboard components via typed hooks

The entire stack lives in your existing TypeScript codebase. There is no separate infrastructure to run, no YAML schema to maintain, and no context switch out of the language your team works in.

## The honest tradeoff

| | Cube | hypequery |
|---|---|---|
| Best for | Centralised metrics for multiple consumers | Product engineers building ClickHouse-backed features |
| Setup | Separate infrastructure and config | npm install, one generate command |
| Type safety | Configuration-defined | Generated from live ClickHouse schema |
| BI tool support | Yes — Tableau, Metabase, etc. | No |
| Caching / pre-aggregations | First-class | Not included |
| Code-first workflow | Partial | Fully code-first |
| ClickHouse support | Yes | Yes — ClickHouse native |

## When to choose Cube

- Your analytics are consumed by BI tools alongside custom dashboards
- You have a data team defining metrics separately from a product team
- You need pre-aggregations and managed caching at scale
- You want a centralised semantic layer across multiple databases

## When to choose hypequery

- You are a product engineering team building ClickHouse-backed features in TypeScript
- You want analytics queries to live in your codebase, not in a separate config system
- You need typed ClickHouse queries serving a REST API and a React dashboard
- You want schema-generated types rather than manually-defined schema

## The mixed setup

Some teams use both. Cube handles the centralised metrics layer for BI and data consumers. hypequery handles the product-facing analytics features where engineering velocity and TypeScript integration matter more than centralised metric governance.

## Getting started with hypequery

If hypequery is the right fit for your use case, the [quick start](/docs/quick-start) covers schema generation, your first typed query, and serving it as a REST endpoint.

For the broader TypeScript options on ClickHouse, read the [ClickHouse TypeScript](/clickhouse-typescript) guide and the [ClickHouse analytics](/clickhouse-analytics) pillar page.
