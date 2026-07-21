---
title: "What Is a Semantic Layer? (And Why ClickHouse Teams Need One)"
description: "A semantic layer is a shared definition of your metrics — what 'revenue' means, exactly, everywhere it appears. Here's what that looks like in practice, the forms it takes, and how ClickHouse + TypeScript teams implement one in code."
seoTitle: "What Is a Semantic Layer? A Practical Definition for Engineers"
seoDescription: "What is a semantic layer? A plain-English definition with concrete examples: dimensions, measures, metrics, grain, and governed filters — plus how ClickHouse and TypeScript teams build one in code."
pubDate: 2026-05-29
heroImage: ""
slug: what-is-a-semantic-layer
status: published
tags:
  - ClickHouse
  - TypeScript
---

**Short answer:** a semantic layer is a single, shared definition of your business metrics that sits between your raw tables and everything that queries them. Instead of every dashboard, API endpoint, and notebook writing its own `SELECT sum(total) FROM orders WHERE ...`, they all ask the semantic layer for "revenue" — and the layer knows exactly what revenue means, which filters always apply, and how it can legally be sliced.

That's the whole idea. The rest of this post is what that looks like in practice: the problem it solves, the vocabulary (dimensions, measures, metrics, grain, governed filters), the four shapes semantic layers commonly take, and — for teams running ClickHouse with a TypeScript backend — what a code-first implementation looks like with [`@hypequery/datasets`](/clickhouse-semantic-layer). If you want to skip ahead and try one, the [quick start](/docs/quick-start) gets you there in a few minutes.

## The problem: three versions of "revenue"

Every team that queries a database directly eventually produces this situation. Three places in the codebase compute revenue. All three are called revenue. All three are different:

```sql
-- The dashboard service
SELECT sum(total) FROM orders WHERE status != 'cancelled';

-- The finance export job
SELECT sum(total) FROM orders WHERE status = 'completed';

-- Someone's notebook, feeding the board deck
SELECT sum(total - refund_amount) FROM orders;
```

None of these is wrong. They're three reasonable interpretations of an ambiguous word, written by three people at three different times. The trouble starts when the dashboard says $412k, finance says $389k, and the board deck says $401k — for the same month. Now someone spends an afternoon diffing SQL to work out which number is "real", and the answer is usually "all of them, depending on what you meant."

The failure isn't a bug in any single query. It's that the *definition* of revenue lives in the queries themselves, copied and mutated across the codebase. Fix the definition in one place and the other two silently keep the old one. We've written before about this exact copy-paste drift in [Stop writing the same query three times](/blog/stop-writing-the-same-query-three-times) — the semantic layer is the structural fix.

A semantic layer moves the definition out of the queries and into one governed place. "Revenue" is defined once: `sum(total)` where `status = 'completed'`, say. Every consumer — dashboard, API, notebook, AI agent — requests the metric by name. If the definition changes, it changes everywhere at once, and the change is a reviewable diff rather than an archaeology project.

## The vocabulary

Semantic layers across vendors share a small core vocabulary. If you know these five terms, you can read any semantic layer's documentation.

**Dimensions** are the attributes you slice by — the columns that end up in `GROUP BY` and `WHERE`. Region, plan tier, order status, signup date. Dimensions answer "broken down by what?"

**Measures** are the aggregations — `sum(total)`, `count(id)`, `avg(latency_ms)`, `quantile(0.95)(duration)`. A measure is an aggregate function bound to a column, possibly with a filter baked in ("sum of total *where status is completed*"). Measures answer "computed how?"

**Metrics** are named, governed business quantities built from measures — the things that appear on dashboards with a straight face. "Revenue" is a metric. "Average order value" is a metric derived from two others (revenue divided by order count). The measure is the mechanical aggregation; the metric is the business contract on top of it.

**Grain** is the level of time (or entity) detail a result is aggregated to: daily, weekly, monthly. "Revenue by day" and "revenue by month" are the same metric at different grains. A semantic layer knows which time column drives the grain so consumers don't each pick their own — which matters more than it sounds, because two dashboards grouping on different timestamp columns is another classic source of mismatched numbers.

**Governed filters** are the conditions that always apply, whether or not the consumer asks. The canonical example is tenant isolation in a multi-tenant product: every query from tenant A must carry `WHERE tenant_id = 'a'`, with no way for a caller to forget it or opt out. Excluding test accounts or internal traffic falls in the same bucket. These are the filters that are too important to leave to convention.

Put together: a consumer asks for *the revenue metric, at daily grain, sliced by the region dimension* — and the layer produces SQL with the correct measure, the correct time column, and the tenant filter it was never given the chance to omit.

## The shapes a semantic layer takes

"Semantic layer" describes a role, not an architecture. In practice it shows up in four forms, each with real trade-offs.

**Inside the BI tool.** Looker's LookML, Power BI datasets, Tableau's data models. You define dimensions and measures in the BI tool's modelling language, and every chart built in that tool uses them consistently. This works well when the BI tool is where all consumption happens. The limitation is the boundary: your application code, your public API, and your other tools can't reuse the definitions. The metrics are consistent inside the walled garden and undefined outside it.

**Standalone platform.** Cube is the best-known example. It runs as a separate service between your database and your consumers: you define the data model in YAML or JS files, Cube exposes a query API (its own JSON format, plus SQL-compatible interfaces), and adds a caching/pre-aggregation store. The strength is universality — one deployment can serve Tableau, Metabase, embedded dashboards, and custom apps from the same definitions, and the pre-aggregation layer is genuinely powerful for heavy dashboards. The cost is operational: it's another service (plus its cache store) to deploy, monitor, and upgrade, and your metric definitions live outside your application's language and type system.

**Warehouse-side.** dbt metrics (MetricFlow) put metric definitions next to your transformation DAG, in YAML, versioned with the rest of your dbt project. This is a natural home if your team already lives in dbt: definitions ride along with the models they describe, in the same review process. The gap is serving — dbt runs on schedules, not per-request, so an application that needs "revenue by day for tenant X, filtered to region Y, right now" still needs a runtime layer in front. We cover that split in detail in [TypeScript vs dbt for ClickHouse](/blog/typescript-vs-dbt-clickhouse).

**Code-first libraries.** The definitions are code in your application repo — typed objects, not YAML in a separate system. The semantic layer is a library your backend imports, not a service it calls. Strengths: definitions are reviewed like any other code, refactored with your editor, type-checked against your schema, and deployed with the app — no extra infrastructure. Weakness: the definitions are scoped to your application's language and runtime, so an external BI tool can't consume them directly (though an HTTP API in front recovers most of that).

None of these is universally right. If your organisation's primary analytics surface is Tableau, a code-first library in a TypeScript repo doesn't help the analysts. If you're a product team embedding analytics in your own app, running a separate modelling service for definitions your backend could just import is overhead you'll resent.

## The ClickHouse + TypeScript case

Now the specific case this blog cares about: you run ClickHouse, your backend is TypeScript, and the main consumers of your metrics are your own product — dashboards in your app, internal APIs, maybe an AI agent. Your "revenue three ways" problem lives in application code, so that's where the fix belongs.

This is the setup [`@hypequery/datasets`](/clickhouse-semantic-layer) is built for: a code-first semantic layer where datasets, dimensions, measures, and metrics are TypeScript in your own repo.

```ts
import { dataset, dimension, measure, eq } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',            // the physical ClickHouse table (or view)
  tenantKey: 'tenant_id',      // governed filter: enforced on every query
  timeKey: 'created_at',       // drives time grain
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
    orderCount: measure.count('id'),
  },
});
```

Everything from the vocabulary section is here, as plain TypeScript. The `revenue` measure carries its filter with it — there is no way to request revenue and get cancelled orders included, because the `status = 'completed'` condition is part of the definition, not part of each call site. `tenantKey` makes tenant isolation a property of the dataset rather than a convention each query must remember. `timeKey` pins the grain to one time column.

Metrics are declared on top, including derived ones:

```ts
import { divide, nullIfZero } from '@hypequery/datasets';

export const revenue = Orders.metric('revenue', { measure: 'revenue' });
export const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

export const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
});
```

`averageOrderValue` is defined *in terms of* the other two metrics. If the revenue definition changes — say finance decides refunds should be netted out — average order value updates automatically, because it references the metric rather than re-implementing the arithmetic. That's the three-versions problem closed off structurally, not by discipline.

Execution goes through a client wired to the typed query builder:

```ts
import { createDatasetClient } from '@hypequery/datasets';
import { db } from './client.js'; // your createQueryBuilder instance

const client = createDatasetClient({ queryBuilder: db });
```

Requests against the client are validated at runtime before any SQL executes: a dimension that doesn't exist on the dataset, an illegal filter, a missing tenant value — all rejected up front rather than producing a wrong-but-plausible result. And because the definitions are ordinary TypeScript modules, changing a metric is a pull request: reviewable diff, type-check in CI, one deploy, every consumer updated.

The honest trade-off is the one from the previous section: this approach assumes your consumers reach metrics through your application (directly, or via HTTP routes you put in front of the definitions). If Tableau and Metabase need to speak to the same semantic layer natively, a standalone platform like Cube is the better-shaped tool — we lay out that comparison honestly in [hypequery vs Cube](/compare/hypequery-vs-cube).

## How to decide

A short decision path:

- Metrics consumed mainly in one BI tool → use that tool's built-in semantic model.
- Many heterogeneous consumers (BI tools + apps) that must share definitions, and you'll accept running a service → a standalone platform like Cube.
- Definitions should live with your dbt transformation DAG, and runtime serving is someone else's job → dbt metrics, plus an application layer in front.
- ClickHouse + TypeScript backend, metrics consumed by your own product → a code-first layer in your repo.

Whichever shape you pick, the bar is the same: one definition of revenue, enforced filters that can't be forgotten, and a change process that's a code review rather than a hunt through three services.

## Where to go from here

- [ClickHouse semantic layer](/clickhouse-semantic-layer) — the pillar page on the code-first approach, with the full datasets model.
- [Introducing hypequery datasets](/blog/introducing-hypequery-datasets) — the design rationale behind `@hypequery/datasets`.
- [TypeScript vs dbt for ClickHouse](/blog/typescript-vs-dbt-clickhouse) — where transformation ends and the runtime layer begins.
- [Quick start](/docs/quick-start) — from a live ClickHouse schema to typed queries in about five minutes.
