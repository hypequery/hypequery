# @hypequery/datasets

The code-first TypeScript semantic layer for ClickHouse.

`@hypequery/datasets` gives product teams one trusted definition for dimensions, measures, metrics, relationships, time grains, and multi-tenant isolation. Keep analytics meaning in the same repo as your application, then reuse it in backend jobs, HTTP APIs, React dashboards, and MCP tools for AI agents.

It builds on the `@hypequery/clickhouse` type-safe query builder, so semantic models and direct ClickHouse queries share generated schema types.

No YAML project. No separate semantic-layer server. Just typed, testable product analytics in code.

## Install

```bash
npm install @hypequery/datasets @hypequery/clickhouse
```

## Define analytics once

```ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    p95OrderValue: measure.percentile('amount', 0.95),
    latestStatus: measure.argMax('status', 'createdAt'),
  },
});

export const revenue = Orders.metric('revenue', {
  measure: 'revenue',
  label: 'Revenue',
});
```

The model is now the contract. Callers can only use the dimensions, measures, filters, and relationships you publish. A declared `tenantKey` requires trusted runtime scope and rejects unscoped execution.

## Query it anywhere

```ts
const result = await analytics.execute(
  revenue,
  {
    dimensions: ['region'],
    orderBy: [{ field: 'revenue', direction: 'desc' }],
    limit: 10,
  },
  {
    runtime: { tenant: session.accountId },
  },
);
```

The same definition can become:

- a named KPI or flexible dataset query;
- a validated `@hypequery/serve` endpoint;
- a typed `@hypequery/react` hook;
- an OpenAI, AI SDK, or MCP tool schema;
- a stable semantic contract for CI and deployment.

## Analytics teams actually need

- sums, counts, distinct counts, averages, min, and max;
- percentiles, median, `argMax`, `argMin`, standard deviation, and variance;
- filtered measures and derived metric formulas;
- daily through yearly time grains;
- fail-closed multi-tenant analytics;
- one-hop typed `belongsTo` and `hasOne` dimensions;
- validated filtering, sorting, and pagination.

See the [current capability matrix](https://hypequery.com/docs/capabilities) for exact syntax and the complete shipped surface.

## Why code-first

Metric changes travel through the workflow your team already trusts: TypeScript, code review, tests, CI, and version control. Backend, frontend, and agent consumers stop maintaining their own definition of “revenue.”

## Learn more

- [Datasets overview](https://hypequery.com/docs/datasets/overview)
- [Measures and metrics](https://hypequery.com/docs/datasets/measures)
- [Multi-tenancy](https://hypequery.com/docs/datasets/multi-tenancy)
- [Relationships](https://hypequery.com/docs/datasets/relationships)
- [MCP tool generation](https://hypequery.com/docs/datasets/tool-generation)

## License

Apache-2.0.
