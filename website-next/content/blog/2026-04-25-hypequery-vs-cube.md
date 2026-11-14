---
title: "hypequery vs Cube: Code-First vs Configuration-First Analytics"
description: "Cube is a semantic layer and analytics platform. hypequery is a code-first analytics layer that lives in your codebase. Here is when each is the right choice for ClickHouse."
seoTitle: "hypequery vs Cube for ClickHouse (2026)"
seoDescription: "Cube is a full semantic layer platform. hypequery is a code-first analytics layer in TypeScript or Python. Compare both for ClickHouse analytics and find the right fit."
pubDate: 2026-04-25
updatedAt: 2026-11-14
heroImage: ""
slug: hypequery-vs-cube
status: published
---

**Short answer:** choose Cube when a data team needs one semantic layer across several databases, BI tools, embedded dashboards, and agents, with managed pre-aggregations and caching. Choose hypequery when a TypeScript or Python product team wants ClickHouse metrics, tenant rules, APIs, React hooks, and agent tools to live with the application code it already deploys.

Cube (formerly Cube.js) is a semantic layer platform: central metric definitions, multiple consumption surfaces, and access control around them. It supports ClickHouse and has a much broader analytics-platform scope than hypequery.

hypequery is not trying to be that category. It is an analytics layer that lives in your codebase, in TypeScript or Python: typed datasets, a composable query builder, typed HTTP APIs, React hooks, and MCP tools for agents. The center of gravity is product code, not a separate analytics platform. You run it in your own backend. A hosted hypequery cloud option is on a waitlist and is not live.

So this is less a feature checklist than a fit question. The tools solve adjacent problems for different team shapes.

## What Cube does well

Cube is designed for organisations that want a centralised metrics definition layer — a "metrics store" that multiple consumers (dashboards, APIs, spreadsheets, BI tools) all read from. Its strengths are:

- **Multi-framework consumption**: the same metric definition can be consumed by Tableau, Metabase, a custom React dashboard, and a REST API simultaneously. BI tools connect through a Postgres-compatible SQL API
- **Caching and pre-aggregations**: Cube Store manages the query cache, the queue and pre-aggregations for performance at scale
- **Access control**: row-level security and tenant isolation are handled in the Cube data model layer
- **No-code and low-code consumption**: non-engineers can query the semantic layer from BI tools without writing code
- **Agents on the semantic layer**: Cube Cloud ships an MCP server and analytics agents, including on its Free plan

These are powerful features for data teams serving multiple internal and external consumers.

## Where Cube becomes a constraint

Cube is not a lightweight tool. Running Cube adds infrastructure: Cube API instances, a refresh worker, and Cube Store router and worker nodes, or a Cube Cloud plan. The configuration-first YAML/JavaScript schema can feel distant from the TypeScript codebase that engineers are working in day-to-day.

For product engineering teams building ClickHouse-powered features into their TypeScript application, Cube can feel like bringing a warehouse-scale tool to a product engineering problem. If you just need typed ClickHouse queries serving a dashboard and an API, Cube's setup cost is high relative to the problem size.

## Where hypequery fits

hypequery is optimised for product engineering teams building ClickHouse-backed features in TypeScript. The workflow is code-first:

1. Generate TypeScript types from your ClickHouse schema
2. Define datasets, measures, dimensions, relationships, and tenant rules in TypeScript
3. Query those datasets in process or serve them as typed HTTP endpoints with OpenAPI docs
4. Consume the same definitions from React hooks or expose them as MCP tools for agents

The entire stack lives in your existing TypeScript codebase. There is no separate infrastructure to run, no YAML schema to maintain, and no context switch out of the language your team works in. The same datasets can also be defined and served from Python.

## The fact-based comparison

| Criterion | Cube | hypequery |
|---|---|---|
| Best fit | A central semantic layer for many consumers and data sources | Product engineers building ClickHouse-backed features |
| Model location | YAML or JavaScript model in a Cube deployment | TypeScript or Python modules in the application repository |
| Metric consistency | One Cube model serves REST, GraphQL, SQL, BI tools, embeds, and agents | One dataset model serves in-process calls, HTTP, React hooks, and MCP tools |
| TypeScript types | API clients consume Cube's semantic query contract | Table types are generated from the live ClickHouse schema; dataset fields are typed in code |
| Tenant and access rules | Security context, access policies, and query rewriting in Cube | Dataset `tenantKey`, with tenant context supplied by the backend and missing context rejected |
| Change workflow | Model changes deploy to Cube separately from the product application | Model changes follow the application's pull request, test, and deploy workflow |
| BI tool support | Yes — including Tableau, Power BI, Metabase, and Superset | No BI-tool SQL interface |
| Embedded UI | Hosted dashboards and React Embed SDK on Cube Cloud Premium and Enterprise | No chart components or dashboard builder; use your own UI |
| Caching / pre-aggregations | Cube Store caching and managed pre-aggregations | Optional result cache; ClickHouse materialized views or projections for rollups |
| Operations | Run Cube Core and Cube Store, or use Cube Cloud | Run the libraries in your existing backend and operate ClickHouse |
| Databases | ClickHouse and many other SQL sources | ClickHouse only |
| MCP and agents | Hosted MCP server and agents in Cube Cloud | `@hypequery/mcp` or the Python MCP server over datasets |
| Pricing | Cube Core is Apache 2.0; Cube Cloud has a Free plan, then $40 or $80 per developer per month | Apache 2.0 libraries are free; the hosted option is not live |

The table was rechecked against Cube's data-modeling, access-control, embedding, MCP, and pricing pages on 14 November 2026. hypequery capability links point to the shipped documentation and source below.

## Governance test: change one metric once

Do not evaluate either option only by building a chart. Define one metric with a real rule — for example, net revenue excluding refunds — and use it from a dashboard, an HTTP client, and an agent. Then change the rule once.

With Cube, the test passes when all three consumers query the same deployed Cube measure and inherit the same security context. With hypequery, it passes when all three consumers use the same dataset definition and the backend supplies the same trusted tenant context. If any consumer carries its own SQL or tenant filter, the architecture has not delivered metric consistency yet.

The [TypeScript embedded analytics buyer's guide](/compare/embedded-analytics-typescript) turns that test into a reusable governance, type-safety, and isolation checklist.

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

## Sources checked

- Cube: [data modeling](https://cube.dev/docs/product/data-modeling), [data access control](https://cube.dev/product/data-access-control), [embedding](https://cube.dev/docs/product/embedding), [MCP server](https://github.com/cube-js/cube/blob/master/docs-mintlify/docs/integrations/mcp-server.mdx), [ClickHouse data source](https://github.com/cube-js/cube/blob/master/docs-mintlify/admin/connect-to-data/data-sources/clickhouse.mdx), and [pricing](https://cube.dev/pricing)
- hypequery: [datasets overview](/docs/datasets/overview), [dataset multi-tenancy](/docs/datasets/multi-tenancy), [HTTP and OpenAPI](/docs/http-openapi), [React hooks](/docs/react/getting-started), and [MCP safety](/docs/mcp/safety)
