---
title: "How to Build Usage-Based Billing with ClickHouse and TypeScript"
description: "A tutorial on metered billing with ClickHouse: an append-only usage_events table, tenant-scoped usage and revenue metrics defined once in TypeScript, monthly rollups, and one definition shared by the invoicing job and the customer usage page."
seoTitle: "Usage-Based Billing with ClickHouse: A TypeScript Tutorial"
seoDescription: "Build usage-based billing on ClickHouse with TypeScript: model a usage_events table, define tenant-isolated revenue metrics once, roll up by month, and serve the same numbers to your billing job and customer dashboard."
pubDate: 2026-07-10
heroImage: ""
slug: usage-based-billing-clickhouse-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

Usage-based billing has a requirement most analytics features do not: the number on the invoice and the number on the customer's usage dashboard must be **identical**. If the dashboard shows 41,300 API calls and the invoice charges for 41,882, you get a support ticket first and a churn conversation second.

**Short answer:** append every billable event to a ClickHouse `usage_events` table, define usage and revenue once as tenant-scoped metrics in TypeScript with [hypequery Datasets](/blog/introducing-hypequery-datasets), and make both consumers — the invoicing job and the customer-facing usage page — execute that same definition. ClickHouse does the aggregation cheaply at any event volume; the semantic layer guarantees the two consumers cannot drift apart, and its tenant rules guarantee one customer never sees another customer's usage.

This tutorial builds the metering and aggregation half of a billing system end to end: the table, the dataset, the metrics, the monthly rollup, the billing job, and the HTTP endpoint the dashboard reads. If you have not set up hypequery before, the [quick start](/docs/quick-start) gets you to a typed client in a few minutes, and the [ClickHouse SaaS analytics guide](/clickhouse-saas-analytics) covers the surrounding architecture.

## Store usage as append-only events

Metering data is a natural fit for ClickHouse: high write volume, no updates, and every read is an aggregation. Store one row per billable event:

```sql
CREATE TABLE usage_events (
  tenant_id String,
  feature LowCardinality(String),
  quantity Decimal(18, 6),
  unit_price Decimal(18, 6),
  created_at DateTime,
  amount Decimal(18, 6) MATERIALIZED quantity * unit_price
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

Three decisions here matter for billing specifically:

- **`Decimal`, not `Float64`, for money.** Float arithmetic on an invoice is how you end up explaining a $0.03 discrepancy to a customer. `quantity` is also a decimal because metered units are often fractional (GB-hours, compute-seconds).
- **`amount` is a materialized column.** The price is captured *at event time* — `quantity * unit_price` is computed on insert. If you change pricing next quarter, historical events still bill at the rate the customer actually agreed to.
- **`ORDER BY (tenant_id, created_at)`.** Every billing query filters by tenant and time range, so the sort key makes those queries cheap.

Corrections are compensating events, not updates: if you over-metered a tenant, insert a row with a negative `quantity`. The sums stay honest and you keep an audit trail for free.

## The monthly rollup in SQL

An invoice for one tenant and one period is a `GROUP BY` away. Here is the raw ClickHouse query, using [`sum()`](/clickhouse/functions/sum) and [`toStartOfMonth()`](/clickhouse/functions/to-start-of-month):

```sql
SELECT
  toStartOfMonth(created_at) AS period,
  feature,
  sum(quantity) AS total_quantity,
  sum(amount) AS revenue
FROM usage_events
WHERE tenant_id = 'tenant_042'
  AND created_at >= '2026-06-01 00:00:00'
  AND created_at <  '2026-07-01 00:00:00'
GROUP BY period, feature
ORDER BY period, feature;
```

This query is correct. The problem is that in a real product it gets written at least three times: once in the invoicing job, once in the usage-page API, and once in an internal admin tool. Each copy is an opportunity for the definitions to diverge — one includes trial tenants, another filters `created_at` with `>=` on both ends and double-counts a boundary event. The rest of this post is about writing it once.

## Define usage and revenue once

With `@hypequery/datasets`, the table becomes a dataset: a typed declaration of which fields consumers may group by, which aggregations exist, and which columns govern tenancy and time.

```ts
// analytics/datasets/usage.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Usage = dataset('usage', {
  source: 'usage_events',
  tenantKey: 'tenant_id',   // every query is scoped to one tenant
  timeKey: 'created_at',    // enables time grains like month
  dimensions: {
    feature: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    totalQuantity: measure.sum('quantity'),
    revenue: measure.sum('amount'),
  },
});
```

Two lines carry most of the weight. `tenantKey: 'tenant_id'` makes tenant isolation part of the model rather than a convention — more on that below. `timeKey: 'created_at'` tells the runtime which column monthly rollups grain on.

Then name the numbers that appear on the invoice as metrics, including a derived one — the effective unit rate a tenant actually paid, which differs from list price whenever pricing changed mid-period or credits landed as negative-quantity events:

```ts
// analytics/metrics/billing.ts
import { divide, nullIfZero } from '@hypequery/datasets';
import { Usage } from '../datasets/usage.js';

export const totalQuantity = Usage.metric('totalQuantity', {
  measure: 'totalQuantity',
  label: 'Billable quantity',
});

export const revenue = Usage.metric('revenue', {
  measure: 'revenue',
  label: 'Usage revenue',
});

export const effectiveUnitRate = Usage.metric('effectiveUnitRate', {
  uses: { revenue, totalQuantity },
  formula: ({ revenue, totalQuantity }) =>
    divide(revenue, nullIfZero(totalQuantity)),
});
```

`nullIfZero` matters here: a tenant with zero usage in a period should produce a `NULL` rate, not a division-by-zero error at 2 a.m. when the invoice run executes.

## Tenant isolation is fail-closed

Billing is the worst possible place to leak data across tenants — a usage page that shows another customer's consumption is both a security incident and a pricing disclosure.

Because the dataset declares `tenantKey`, execution is fail-closed: every query must carry trusted tenant context, the runtime injects the `tenant_id` predicate itself, and caller-supplied filters on the tenant column are rejected so request input can never widen the scope. A query with no tenant context stops before any SQL reaches ClickHouse. The general pattern — and the trade-offs versus row policies in ClickHouse itself — is covered in the [multi-tenant analytics guide](/clickhouse-multi-tenant-analytics).

Wire the dataset to the same typed query builder the rest of your app uses:

```ts
// analytics/client.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';
import type { IntrospectedSchema } from './generated/schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export const analytics = createDatasetClient({ queryBuilder: db });
```

## The billing job

The invoice generator runs per tenant, per period. It asks for revenue broken down by feature over a half-open date interval — the same shape as the raw SQL earlier, but expressed against the semantic definition:

```ts
// jobs/generate-invoices.ts
import { gte, lt } from '@hypequery/datasets';
import { analytics } from '../analytics/client.js';
import { revenue } from '../analytics/metrics/billing.js';

export async function buildInvoiceLines(
  tenantId: string,
  periodStart: string, // '2026-06-01 00:00:00'
  periodEnd: string,   // '2026-07-01 00:00:00'
) {
  const result = await analytics.execute(revenue, {
    dimensions: ['feature'],
    filters: [gte('createdAt', periodStart), lt('createdAt', periodEnd)],
    orderBy: [{ field: 'feature', direction: 'asc' }],
  }, {
    runtime: { tenant: tenantId },
  });

  return result.data; // one row per feature: the invoice line items
}
```

The half-open interval (`gte` start, `lt` end) is deliberate — an event at exactly midnight on the first of the month lands in exactly one invoice, never zero or two.

One runtime detail that bites billing code specifically: ClickHouse returns `Decimal` and `UInt64` values as **strings** in JavaScript — `UInt64` because it can exceed `Number.MAX_SAFE_INTEGER`, `Decimal` to preserve exact precision that a JS `number` would round off. hypequery's generated types encode this. Keep invoice amounts as strings and hand them to a decimal library; the moment someone writes `parseFloat` on a money field, the invoice and the dashboard can disagree in the last cent.

## Monthly rollups with time grains

The customer usage page usually wants a time series, not a single period total. Because the dataset declared `timeKey`, any metric can be grained with `.by()`:

```ts
import { gte } from '@hypequery/datasets';
import { analytics } from '../analytics/client.js';
import { revenue } from '../analytics/metrics/billing.js';

const monthly = await analytics.execute(revenue.by('month'), {
  filters: [gte('createdAt', '2026-01-01 00:00:00')],
}, {
  runtime: { tenant: tenantId },
});
// each row: a `period` bucket (toStartOfMonth) plus the revenue value
```

Under the hood this generates `toStartOfMonth(created_at) AS period ... GROUP BY period ORDER BY period` — you can confirm with `analytics.toSQL(revenue.by('month'), ...)`. Day, week, month, quarter, and year grains are supported, and the grain lives in the definition rather than in each caller, so "monthly revenue" means the same bucketing everywhere.

## The customer-facing usage page

The dashboard should not get its own hand-rolled endpoint with its own aggregation logic. `@hypequery/serve` turns the exact same metric objects into governed HTTP routes:

```ts
// analytics/api.ts
import { initServe } from '@hypequery/serve';
import { db } from './client.js';
import { Usage } from './datasets/usage.js';
import { revenue, totalQuantity, effectiveUnitRate } from './metrics/billing.js';

const { serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

export const api = serve({
  queryBuilder: db,
  datasets: { usage: Usage },
  metrics: { revenue, totalQuantity, effectiveUnitRate },
});
```

This exposes `POST /api/analytics/metrics/revenue` (and siblings) with zod-validated inputs and an OpenAPI document describing the allowed dimensions, filters, and grains. Your auth layer resolves the tenant from the session and supplies it as the trusted runtime context — the browser never sends a tenant id the server trusts. On the frontend, `@hypequery/react` consumes these endpoints with TanStack Query hooks.

Now trace both paths. The invoicing job calls `analytics.execute(revenue, ...)` in-process. The usage page hits `/api/analytics/metrics/revenue` over HTTP. Both resolve to the same `revenue` metric on the same `Usage` dataset with the same tenant rule and the same time grain. When finance changes what counts as billable revenue — say, excluding a beta feature — it is one reviewed diff in `billing.ts`, and the invoice and the dashboard change together.

## What ClickHouse metering does not solve

Being honest about scope: this stack is the *metering and aggregation* layer, not a complete billing system.

- **Rating complexity.** Tiered pricing, volume discounts, committed-use credits, proration, and tax are business logic. Common practice is to keep ClickHouse as the source of truth for *quantities*, compute simple `amount` at event time as shown here, and let a billing engine (Stripe metered billing, Lago, Metronome) handle rating and payment collection on top of the totals you export.
- **Invoice immutability.** An invoice is a snapshot. Generate it, persist the line items in your transactional database, and never silently recompute a closed period — late-arriving events belong on the next invoice as adjustments.
- **Ingestion idempotency.** ClickHouse will happily store the same event twice. Give events a deterministic id at the producer and dedupe before or during insert; retried webhooks are the classic double-billing source.

None of these change the core claim, though. The failure mode this architecture removes is the most common and most embarrassing one: two codepaths computing "usage" differently.

## Where to go from here

- [Introducing hypequery Datasets](/blog/introducing-hypequery-datasets) — the full semantic layer model: datasets, metrics, tenancy, serve integration.
- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics) — tenant isolation strategies in depth, including fail-closed runtime scoping.
- [ClickHouse for SaaS analytics](/clickhouse-saas-analytics) — where metering fits in a broader SaaS analytics backend.
- [Quick start](/docs/quick-start) — generate types from your schema and run your first typed query.
