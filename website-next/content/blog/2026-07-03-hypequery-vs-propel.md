---
title: "hypequery vs Propel: Platform APIs or a Typed Layer in Your Own Repo?"
description: "Propel sells managed analytics APIs and embeddable UI components over ClickHouse. hypequery is the code-first route to the same outcome. Here's how to pick."
seoTitle: "hypequery vs Propel — ClickHouse Analytics API Comparison"
seoDescription: "Propel is a serverless ClickHouse platform with GraphQL APIs and embedded analytics components. hypequery is an open-source TypeScript layer for your own ClickHouse. Compare both."
pubDate: 2026-07-03
heroImage: ""
slug: hypequery-vs-propel
status: published
---

Propel and hypequery are both trying to close the same gap: ClickHouse is fast, but there's a lot of work between "the data is in ClickHouse" and "our product has analytics."

Propel closes it with a platform. You connect data — Kafka, S3, Postgres, Snowflake, or an existing ClickHouse — and Propel gives you managed query APIs, a semantic layer for metric definitions, multi-tenant access policies, and embeddable React components for dashboards.

hypequery closes it with code. You point it at the ClickHouse you already run, it generates TypeScript types from your schema, and you write queries and serve them as typed endpoints from your own application.

Same destination, very different relationship with your stack.

## What Propel does well

Propel has clearly optimised for time-to-shipped-dashboard, and it shows:

- **Managed serving.** GraphQL and SQL APIs with auto-scaling, without building or operating an API layer yourself.
- **Embeddable UI components.** Prebuilt React components for charts and dashboards that sit directly on Propel's APIs. If the job is "put a usage dashboard in our SaaS product this month," this is the fastest route on this page.
- **A semantic layer.** Metrics defined once, queried from anywhere, with multi-tenant access policies enforced at the platform level.
- **Flexible data plumbing.** Ingest from Kafka, S3, Snowflake, or Postgres — or connect your existing self-hosted ClickHouse or ClickHouse Cloud, in which case your data stays put.

That last point matters: unlike some managed platforms, Propel doesn't force ingestion. The bring-your-own-ClickHouse option removes the data residency objection.

## Where the platform model costs you

**The serving layer isn't yours.** Your queries run through Propel's APIs, your metric definitions live in Propel's semantic layer, and your dashboards render Propel's components. That's the point — but it also means your analytics surface is coupled to a vendor's platform, roadmap, and uptime.

**Types come from their schema, not yours.** You can codegen TypeScript from Propel's GraphQL API, which is better than nothing — but the types describe Propel's query interface, not your ClickHouse tables. There's still a translation layer between your data model and your application code.

**Usage-based pricing.** Storage and query costs scale with the product's success. Predictable for small workloads; a line item worth watching for high-traffic embedded analytics.

**Another definition of your metrics.** If your team already defines metrics in code, adding a platform-level semantic layer means one more place where "active users" has to mean the same thing.

## What hypequery does instead

hypequery assumes the thing you want to own is exactly the thing Propel manages for you:

1. Run `generate` against your ClickHouse — types are created from your live schema, with ClickHouse-correct runtime mappings
2. Write queries in TypeScript with the composable query builder; runtime parameters like date ranges and tenant IDs are just function arguments
3. Serve them as REST endpoints with validation and OpenAPI docs via `@hypequery/serve`
4. Build dashboards with your own components, consuming the same typed contracts through React hooks

Everything is open source, everything lives in your repo, and the only infrastructure is the ClickHouse you were already running.

## The honest comparison

| | Propel | hypequery |
|---|---|---|
| Model | Serverless platform | Open-source library |
| Serving | Managed GraphQL and SQL APIs | Typed REST endpoints in your app |
| UI | Embeddable React components included | Bring your own components, typed hooks provided |
| Types | Codegen from Propel's GraphQL schema | Generated from your ClickHouse schema |
| Semantic layer | Platform-level metric definitions | Metrics as TypeScript code in your repo |
| Multi-tenancy | Platform access policies | Your auth context, injected per request |
| Data location | Managed, or bring your own ClickHouse | Always your own ClickHouse |
| Pricing | Usage-based | Free — you pay for your infra |

## When to choose Propel

- You need customer-facing dashboards live in weeks, and prebuilt components get you there
- Nobody on the team wants to build or run an API layer, even a thin one
- Platform-enforced multi-tenant access policies fit your compliance story
- Usage-based pricing is acceptable for your traffic profile

## When to choose hypequery

- You want the analytics layer in your own repo, reviewed and shipped like the rest of your code
- Response types should come from your actual ClickHouse schema, not a platform's API
- You already have components, auth, and an API stack — you need the typed ClickHouse layer, not a second platform
- You'd rather pay for infrastructure than per query

## Getting started

The [quick start](/docs/quick-start) goes from schema introspection to a served, typed endpoint in a few minutes. If embedded analytics is the use case you're weighing, the [ClickHouse SaaS analytics](/clickhouse-saas-analytics) guide covers tenant isolation patterns, and [ClickHouse React](/clickhouse-react) shows the hooks side of the same contract.
