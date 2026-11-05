---
name: hypequery-datasets
description: Author and change hypequery semantic-layer datasets for ClickHouse in TypeScript (@hypequery/datasets) or Python (hypequery). Use when defining or editing dimensions, measures, derived measures, metrics, relationships, tenant keys or time grains, scaffolding datasets from a ClickHouse schema, or exposing them over HTTP or MCP.
---

# hypequery datasets

A dataset is a typed semantic model over one ClickHouse table: dimensions you can
group and filter by, measures you can aggregate, and rules (tenant key, time key,
limits). Callers select dimensions and measures by name; hypequery validates the
request, generates parameterized SQL and runs it. Definitions live in the
application's own code, so changes go through review, tests and CI.

Full docs: https://hypequery.com/llms.txt (index of every page as Markdown).

## Start from the live schema, then curate

- TypeScript: `npx hypequery generate:datasets` writes `analytics/datasets.ts`.
- Python: `hypequery init` (guided) or `hypequery generate datasets` writes `datasets.py`.

Both read `CLICKHOUSE_URL` (or `CLICKHOUSE_HOST`, `_PORT`, `_DATABASE`,
`_USERNAME`, `_PASSWORD`) from the environment or `.env`. Generated measures are
suggestions: rename dimensions and measures to the product's language, delete
meaningless ones (sums of IDs), and add descriptions — agents read them.

## TypeScript

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, dataset, dimension, divide, eq, measure, nullIfZero } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',        // every query must carry a trusted tenant
  timeKey: 'created_at',
  description: 'Customer orders.',
  dimensions: {
    status: dimension.string(),
    country: dimension.string({ column: 'country_code', description: 'ISO country' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    buyers: measure.countDistinct('customerId'),
    p95OrderValue: measure.percentile('amount', 0.95),
    averageOrderValue: measure.derived({
      uses: { revenue: 'revenue', orders: 'orderCount' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
});

const db = createQueryBuilder({ url: process.env.CLICKHOUSE_URL!, database: process.env.CLICKHOUSE_DATABASE });
export const analytics = createDatasetClient({ queryBuilder: db });

const result = await analytics.execute(
  Orders,
  { dimensions: ['country'], measures: ['revenue'], filters: [eq('status', 'paid')], by: 'month', limit: 10 },
  { runtime: { tenant: session.accountId } },
);
```

- Always build the client with `createDatasetClient({ queryBuilder })`.
- Measure helpers: `sum`, `count`, `countDistinct`, `approxCountDistinct`, `avg`,
  `min`, `max`, `percentile`, `median`, `argMax`, `argMin`, `stddev`, `variance`;
  `measure.merge('uniq', 'users')` reads AggregatingMergeTree state columns. Measures take
  `{ filters: [...] }` for filtered measures.
- ReplacingMergeTree / CollapsingMergeTree sources need row resolution (`FINAL`)
  or they double count; see https://hypequery.com/docs/capabilities.
- Relationships (`belongsTo`, `hasOne`) expose one hop of related dimensions.
- Filter helpers: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `inList`, `notInList`,
  `between`, `like`, `isNull`, `isNotNull`.

## Python

```python
from hypequery.datasets import (
    DatasetQuery,
    ExecutionContext,
    create_dataset_client,
    dataset,
    dimension,
    filter,
    measure,
    tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

orders = dataset(
    "orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={"country": dimension.string(), "status": dimension.string()},
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)
client = create_dataset_client(executor=create_clickhouse_executor(ClickHouseConnection.from_env()))
result = client.execute(
    orders,
    DatasetQuery(
        dimensions=("country",), measures=("revenue",), filters=(filter.eq("status", "paid"),)
    ),
    context=ExecutionContext(tenant=tenant("org_123")),
)
```

- Datasets reached through a relationship must be in the client's registry:
  `create_dataset_client(executor=..., registry=create_dataset_registry(orders, customers))`.
- Derived measures: `measure.derived(formula.divide("revenue", formula.null_if_zero("orders")))`.
- Python supports a subset of TypeScript's measures; check
  https://hypequery.com/docs/python/feature-status before using one.

## Rules that keep the model safe

- Never take a tenant from user or agent input. It comes from the authenticated
  principal (`runtime.tenant` in TypeScript, `ExecutionContext(tenant=...)` or
  `client.for_tenant(...)` in Python, or the Serve API's auth).
- Prefer named measures over raw `sql` expressions; SQL-backed dimensions are
  trusted model code, never request input.
- Give datasets, dimensions and measures a `description`; it is what agents and
  generated clients show.

## Expose it

- HTTP: `@hypequery/serve` (TypeScript) or `hypequery.serve` `create_api` +
  `add_dataset_endpoint` (Python). Pass `client_profile=ClientQueryProfile()` and
  call `add_client_contract_endpoint(api)` to publish a client contract.
- AI agents over MCP: `npx hypequery mcp` (TypeScript project) or
  `hypequery mcp app:api` (Python, `pip install "hypequery[mcp]"`); add
  `--print-config` for the Claude or Cursor entry.
