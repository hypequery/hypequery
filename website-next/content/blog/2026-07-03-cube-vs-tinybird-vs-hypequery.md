---
title: "Cube vs Tinybird vs hypequery: Three Ways to Put an API on ClickHouse"
description: "Cube, Tinybird, and hypequery all sit between ClickHouse and your application — but they're a platform, a managed service, and a library. Here's how to actually choose."
seoTitle: "Cube vs Tinybird vs hypequery — ClickHouse Analytics API Comparison"
seoDescription: "Comparing Cube, Tinybird, and hypequery for serving ClickHouse analytics: architecture, pricing, type safety, and which one fits your team."
pubDate: 2026-07-03
heroImage: ""
slug: cube-vs-tinybird-vs-hypequery
status: published
---

If you search "Cube vs Tinybird," you'll mostly find each vendor explaining why the other one is solving a different problem. Which is actually true — they are. But it's not very helpful when what you have is a ClickHouse full of data, an application that needs analytics, and a decision to make.

So here's the version with all three options on the table, including the one where you don't adopt a platform at all.

## The one-sentence versions

**Cube** is a semantic layer platform. It sits between your databases (ClickHouse among many) and your consumers (BI tools, apps, spreadsheets), giving everyone one set of metric definitions, plus caching and pre-aggregations.

**Tinybird** is a managed analytics backend. Your data moves into their ClickHouse, you write SQL Pipes, and each Pipe becomes a hosted API endpoint with auth, rate limiting, and caching handled for you.

**hypequery** is an open-source TypeScript library. It points at the ClickHouse you already run, generates types from your schema, and turns queries written in your repo into typed REST endpoints and React hooks.

A platform, a service, and a library. Most of the decision falls out of which of those shapes fits your team.

## What each one is actually for

### Cube: many consumers, one set of definitions

Cube earns its complexity when the same metrics need to reach multiple consumers — Tableau over the SQL API, an embedded dashboard over REST, a data app over GraphQL — and you need "revenue" to mean the same thing in all of them. Pre-aggregations are the other headline: for expensive queries hit by many users, Cube's caching layer does real work.

The cost is that Cube is infrastructure. There's an API server and a cache store to run (or a Cube Cloud bill), a modelling layer in YAML/JS to maintain, and a query JSON format your app speaks instead of SQL or your own types.

### Tinybird: zero ops, fastest path to a hosted API

Tinybird's whole pitch is speed without infrastructure. Data streams in, SQL Pipes transform it, and endpoints appear with tokens, rate limits, and caching already sorted. For a team with no ops capacity that needs a public-facing data API this quarter, it's genuinely hard to beat.

The costs are the ones managed platforms always have: your data lives in their ClickHouse, pricing scales with data processed and API calls, and the workflow is SQL-first — your TypeScript app consumes untyped HTTP endpoints and maintains its own interfaces.

### hypequery: your ClickHouse, your repo, your types

hypequery assumes the database part is handled — you're on ClickHouse Cloud or self-hosting — and the missing piece is everything between ClickHouse and your TypeScript code. Types are generated from the live schema (with correct runtime mappings — `UInt64` comes back as a string, and your types know it). Queries are code. Endpoints come from `@hypequery/serve` with validation and OpenAPI docs. Dashboards use typed React hooks on the same contracts.

The cost: you run your own ClickHouse (or pay ClickHouse Cloud to), and auth, caching, and rate limiting come from your existing API stack rather than a platform.

## The table

| | Cube | Tinybird | hypequery |
|---|---|---|---|
| Shape | Semantic layer platform | Managed analytics service | Open-source library |
| Your data lives | In your databases | In Tinybird's ClickHouse | In your ClickHouse |
| Queries defined in | YAML/JS data models | SQL Pipes in their platform | TypeScript in your repo |
| TypeScript types | Hand-written for Cube responses | Hand-written for HTTP responses | Generated from your schema |
| BI tools (Tableau etc.) | Yes — a core strength | Not the focus | No |
| Caching / pre-aggs | Built in — a core strength | Built in | Bring your own / ClickHouse MVs |
| Auth & rate limiting | Built in | Built in | Your existing API stack |
| Ops burden | Run Cube (or pay Cube Cloud) | None | Run ClickHouse (or use Cloud) |
| Pricing | OSS + Cube Cloud tiers | Data processed + API calls | Free, open source |
| Databases | Many | ClickHouse (theirs) | ClickHouse (yours) |

## How to actually decide

**Do BI tools need to consume the same metrics as your app?** If yes, Cube — it's the only one of the three that treats Tableau and Metabase as first-class consumers.

**Do you have zero ops capacity and no ClickHouse yet?** Tinybird. Adopting ClickHouse plus an API layer is exactly the work it exists to remove. (Compare honestly against ClickHouse Cloud + hypequery, which keeps ownership at the cost of slightly more assembly.)

**Do you already run ClickHouse and build in TypeScript?** This is hypequery's home turf. A platform in the middle adds a second place your schema lives, a second pricing meter, and a second deploy pipeline — for capabilities your API stack may already have.

**Is data residency non-negotiable?** Tinybird is out. Cube and hypequery both leave data where it is.

**Is the team SQL-first rather than TypeScript-first?** Tinybird's Pipes workflow will feel natural. hypequery's value — compile-time types, code review, refactoring — mostly pays off for teams living in TypeScript.

## Can you mix them?

Sometimes sensibly. Cube for the data team's BI consumers plus hypequery for product-facing features is a real pattern — they serve different audiences from the same ClickHouse. Tinybird combines less well, since it wants to be the database too.

## Where to go from here

The pairwise pages go deeper: [hypequery vs Cube](/compare/hypequery-vs-cube) and [hypequery vs Tinybird](/compare/hypequery-vs-tinybird). If you're leaving one of them, the switching guides cover migration specifics: [Cube.js alternative](/cube-js-alternative), [Tinybird alternative](/tinybird-alternative).

And if you want to skip straight to evidence: the [quick start](/docs/quick-start) gets you from your ClickHouse schema to a typed, served endpoint in a few minutes — which is usually enough to know whether the library approach fits.
