---
title: Semantic Dataset Roadmap
description: Roadmap and task tracking for semantic dataset catalog, governance, lifecycle, and agent capabilities.
---

# Semantic Dataset Roadmap

Status: proposed feature roadmap.

Goal: make Hypequery a TypeScript-native semantic layer for ClickHouse, robust enough for enterprise SaaS, embedded analytics, governed internal analytics, BI/explore workflows, and AI/agent access.

This is broader than the original "dynamic dataset API" request. Dynamic runtime querying is one capability inside a larger semantic-layer product surface: catalog, governance, safe query planning, relationship traversal, metric/time semantics, lifecycle tooling, observability, and acceleration.

## Current Code Context

Hypequery already has a strong foundation:

- `@hypequery/clickhouse`: typed ClickHouse query builder, formatter, adapter, cache primitives, joins, and execution.
- `@hypequery/datasets`: semantic datasets, dimensions, measures, metrics, validation, tenant runtime, SQL generation, and direct execution.
- `@hypequery/serve`: HTTP runtime, auth, tenancy, OpenAPI/docs, route manifests, middleware, CORS, query logging, and generated dataset/metric endpoints.
- `@hypequery/react`: TanStack Query hooks for served APIs and semantic dataset/metric endpoints.
- `@hypequery/cli`: scaffolding, schema generation, dataset generation, and local API module loading.
- `@hypequery/mcp-server`: MCP tools for listing, introspecting, and querying datasets/metrics.
- `@hypequery/schema`: schema snapshots, diffs, migration planning, and compatibility checks.

Core dynamic dataset querying already works:

```ts
const analytics = createDatasetClient({ queryBuilder: db });

const result = await analytics.execute(Orders, {
  dimensions: ['status'],
  measures: ['revenue', 'orderCount'],
  filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  limit: 100,
});
```

Serve can expose datasets as generated endpoints:

```ts
export const api = serve({
  queryBuilder: db,
  datasets: {
    orders: Orders,
  },
});
```

That registers:

```http
POST /api/analytics/datasets/orders/query
```

with input like:

```json
{
  "dimensions": ["status"],
  "measures": ["revenue"],
  "limit": 100
}
```

## Prioritization Model

Priority:

- P0: Required for enterprise readiness and core semantic-layer positioning.
- P1: Important differentiator or major DX/analytics capability.
- P2: Scale, ecosystem, or advanced platform capability.

Change size:

- Major: new public API, cross-package behavior, query planner changes, or migration risk.
- Medium: meaningful feature mostly contained to one or two packages.
- Minor: additive helper, docs, metadata, hardening, or low-risk type/API improvement.

Enterprise value:

- Governance: security, policy, access control, auditability.
- Correctness: preventing wrong metrics, fanout bugs, unsafe SQL, schema drift, or ambiguous joins.
- Scale: caching, acceleration, materialization, limits, and operational controls.
- DX: type safety, codegen, CLI workflows, validation, and testing.
- AI readiness: safe tools, schema descriptions, explainability, and constrained execution.

## Roadmap Overview

| Priority | Feature Area | Change Size | Primary Packages | Enterprise Value |
|---|---:|---:|---|---|
| P0 | Catalog/introspection unification | Medium | `datasets`, `serve`, `mcp-server`, `cli` | AI readiness, DX |
| P0 | Safe semantic expression system | Major | `datasets`, `clickhouse`, `schema`, `cli` | Correctness, Governance |
| P0 | Semantic governance and field policies | Major | `datasets`, `serve`, `react`, `mcp-server` | Governance |
| P0 | Semantic contract lifecycle | Major | `datasets`, `cli`, `schema`, `serve` | Correctness, DX |
| P0 | Enterprise observability and audit events | Medium | `serve`, `datasets`, `clickhouse`, `mcp-server` | Governance, Scale |
| P1 | Relationship-aware semantic queries | Major | `datasets`, `clickhouse`, `serve`, `react`, `mcp-server` | Correctness, DX |
| P1 | Rich metric vocabulary | Major | `datasets`, `clickhouse`, `serve`, `react`, `mcp-server` | Correctness, DX |
| P1 | Advanced time semantics | Major | `datasets`, `clickhouse`, `serve`, `react`, `mcp-server` | Correctness, DX |
| P1 | Query-dependent TypeScript result types | Medium | `datasets`, `serve`, `react` | DX |
| P1 | AI tool generation | Medium | `datasets`, `mcp-server`, `serve` | AI readiness, Governance |
| P1 | BI/explore query API | Major | `datasets`, `serve`, `react`, `mcp-server` | DX, AI readiness |
| P1 | Semantic caching and acceleration | Major | `datasets`, `clickhouse`, `serve`, `schema` | Scale |
| P2 | Materialized view and rollup planner | Major | `schema`, `datasets`, `clickhouse`, `cli` | Scale |
| P2 | Semantic package/codegen ecosystem | Medium | `cli`, `serve`, `react`, `mcp-server` | DX |
| P2 | Tenant-specific dynamic registries | Major | `datasets`, `serve`, `mcp-server`, `cli` | Governance, DX |

## 1. Catalog And Introspection Unification

Priority: P0

Change size: Medium

Primary packages: `@hypequery/datasets`, `@hypequery/serve`, `@hypequery/mcp-server`, `@hypequery/cli`

### Current State

Dataset metadata exists, but there is not yet one canonical semantic catalog object that Serve, React, MCP, CLI, docs, and future tool generators all consume.

MCP introspection is also partially stale: it looks for `dataset.metrics`, while the current dataset model exposes `measures` and metric refs created through `dataset.metric(...)`.

### Missing Capabilities

- Canonical dataset catalog export.
- Measures vs named metrics distinction.
- Filter metadata and allowed operators.
- Time-grain support metadata.
- Tenant requirements.
- Relationship metadata with execution support status.
- UI/catalog hints.
- Policy-aware catalog filtering.
- Tests using real `@hypequery/datasets` instances.

### Recommended API Direction

```ts
const catalog = createSemanticCatalog({
  datasets: { orders: Orders },
  metrics: { revenue, orderCount },
});

const orders = catalog.getDataset('orders');
```

Recommended catalog shape:

```ts
type DatasetCatalog = {
  name: string;
  source: string;
  tenantKey?: string;
  timeKey?: string;
  dimensions: Record<string, DimensionCatalogEntry>;
  measures: Record<string, MeasureCatalogEntry>;
  metrics: Record<string, MetricCatalogEntry>;
  filters: Record<string, FilterCatalogEntry>;
  relationships: Record<string, RelationshipCatalogEntry>;
  limits?: DatasetLimits;
  requiresTenant: boolean;
  supportedGrains: TimeGrain[];
  orderableFields: string[];
  maxLimit?: number;
};
```

Example output:

```json
{
  "name": "orders",
  "source": "orders",
  "tenantKey": "tenant_id",
  "timeKey": "created_at",
  "dimensions": {
    "status": {
      "type": "string",
      "column": "status",
      "label": "Status",
      "filterable": true,
      "groupable": true
    }
  },
  "measures": {
    "revenue": {
      "aggregation": "sum",
      "field": "amount",
      "label": "Revenue"
    }
  },
  "filters": {
    "status": {
      "field": "status",
      "operators": ["eq", "in"]
    }
  }
}
```

### Implementation Work

- Done in this PR: Add catalog construction in `@hypequery/datasets`.
- Done in this PR: Make MCP introspection consume the catalog.
- Done in this PR: Distinguish raw measures from named metrics in the datasets catalog and MCP schema output.
- Done in this PR: Add tests using real `@hypequery/datasets` instances for catalog and MCP introspection.
- Done in this PR: Add dashboard/tool metadata to the catalog: default filter operators, filter value types, supported time grains, tenant requirement, orderable fields, max result limit, and measure filter counts.
- Done in this PR: Make Serve endpoint descriptions and OpenAPI input schemas consume the catalog for dataset fields, filters, order fields, grains, tenant state, and relationship metadata.
- Done in this PR: Add catalog-backed AI tool generation helpers for catalog, per-dataset, and per-metric tools, with OpenAI, AI SDK, and MCP metadata adapters.
- Deferred to follow-up PR: Update CLI generation to emit catalog-friendly labels/descriptions.
- Deferred to follow-up PR: Add cross-package contract tests to prevent catalog/OpenAPI/MCP drift.

### Acceptance Criteria

- MCP, Serve docs, OpenAPI, generated tools, and React metadata use the same catalog source.
- Real dataset instances expose dimensions, measures, filters, relationships, tenant keys, and limits correctly.
- Agent-facing metadata does not expose unauthorized fields once governance policies are added.

## 2. Safe Semantic Expression System

Priority: P0

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/schema`, `@hypequery/cli`

### Current State

Semantic requests validate dimensions, measures, filters, ordering, tenancy, limits, and time grains before building SQL. That is a strong safety boundary for served dataset endpoints.

The lower-level ClickHouse query builder is more permissive by design. Formatter paths interpolate identifiers and raw fragments such as table names, column names, aliases, subqueries, and raw predicates. This is acceptable for trusted developer-authored code, but it should not be confused with a safe public semantic input surface.

### Missing Capabilities

- Safe semantic expression AST for dimensions and measures.
- Central identifier quoting/validation across builder and semantic planner.
- Explicit unsafe/raw APIs and docs.
- Validation for custom SQL expressions used in datasets.
- ClickHouse function allowlist for semantic expressions.
- Trust-boundary docs: raw builder is trusted code; semantic endpoints are public-safe.
- Security tests proving untrusted dataset request input cannot escape declared fields.

### Recommended API Direction

Prefer structured semantic expressions:

```ts
const Orders = dataset('orders', {
  source: table('orders'),
  dimensions: {
    country: dimension.string({
      expr: ref('shipping_country'),
    }),
    createdMonth: dimension.timestamp({
      expr: toStartOfMonth(ref('created_at')),
    }),
  },
  measures: {
    netRevenue: measure.sum(
      subtract(ref('gross_amount'), ref('discount_amount')),
    ),
  },
});
```

Keep raw SQL, but make the trust boundary explicit:

```ts
dimension.string({
  unsafeSql: "JSONExtractString(metadata, 'country')",
});
```

### Implementation Work

- Add expression primitives in `@hypequery/datasets`.
- Add ClickHouse rendering for semantic expressions.
- Move identifier validation/quoting to a shared utility.
- Mark current `sql` fields as trusted-code escape hatches.
- Add migration path from `sql` to `expr`.
- Add tests for malicious field names, aliases, filters, relationship paths, and formulas.
- Document CLI API loading as code execution, not static analysis.

### Acceptance Criteria

- User/agent request input can only reference declared semantic fields.
- Unsafe SQL escape hatches are explicit in API names and docs.
- Identifier rendering is consistent across builder and semantic planner.
- Security tests cover common SQL injection attempts through semantic input.

## 3. Semantic Governance And Field Policies

Priority: P0

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Current State

Serve supports route-level auth, roles, scopes, tenant extraction, and tenant filtering. The semantic model itself does not yet define access policies for datasets, dimensions, measures, metrics, filters, or relationships.

### Missing Capabilities

- Dataset-level policies.
- Dimension/measure/metric-level policies.
- Hidden/internal fields.
- Field masking and redaction.
- Filter permissions.
- Row-level policies beyond a single tenant key.
- Hierarchical tenant scopes.
- ABAC policies based on auth metadata.
- Policy-aware OpenAPI/docs/React/MCP metadata.
- Policy failure error type distinct from validation errors.

### Recommended API Direction

```ts
const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'organization_id',
  access: {
    requiresRole: ['analytics_viewer'],
    rowPolicy: ({ auth }) => ({
      field: 'region',
      operator: 'in',
      value: auth.metadata.allowedRegions,
    }),
  },
  dimensions: {
    customerEmail: dimension.string({
      column: 'customer_email',
      access: {
        requiresScope: ['pii:read'],
        mask: 'email',
      },
    }),
  },
  measures: {
    revenue: measure.sum('amount', {
      access: {
        requiresScope: ['finance:read'],
      },
    }),
  },
});
```

### Implementation Work

- Add access metadata to dataset, dimension, measure, metric, filter, and relationship definitions.
- Add policy evaluation to validation and execution.
- Filter catalog/OpenAPI/MCP metadata by auth context.
- Ensure unauthorized fields cannot be queried even if manually posted to the endpoint.
- Add policy audit events.
- Add policy-aware type/codegen story for clients.

### Acceptance Criteria

- Unauthorized fields are unavailable in docs, MCP schemas, generated tools, and query execution.
- Tenant filtering cannot be overridden by user filters.
- Policy failures are deterministic and auditable.
- Policy checks are covered through direct client, Serve, and MCP paths.

## 4. Semantic Contract Lifecycle

Priority: P0

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/cli`, `@hypequery/schema`, `@hypequery/serve`

### Current State

Query-time validation exists. `@hypequery/schema` has schema snapshots, diffs, migration planning, and dataset compatibility checks. Semantic contracts do not yet have a complete lifecycle around snapshots, breaking-change detection, CI validation, docs, and lineage.

### Missing Capabilities

- Stable semantic contract JSON.
- Semantic model validation CLI.
- Breaking-change detection for datasets/metrics.
- Contract snapshots.
- Field/metric deprecation metadata.
- Schema drift detection against ClickHouse.
- Required labels/descriptions linting.
- Metric lineage and dependency graph.
- CI-friendly output.
- Generated docs from semantic contracts.

### Recommended CLI Direction

```bash
hypequery semantic validate
hypequery semantic snapshot --out semantic.snapshot.json
hypequery semantic diff semantic.snapshot.json
hypequery semantic doctor
```

### Implementation Work

- Define a stable semantic contract JSON format.
- Export contracts from datasets and metric refs.
- Compare snapshots in CI.
- Detect breaking changes:
  - removed dataset
  - removed dimension, measure, metric, or filter
  - type change
  - tenant policy change
  - relationship change
  - metric formula change
- Add `deprecated`, `sunsetAt`, and `replacement` metadata.
- Add ClickHouse introspection checks for referenced columns and sources.
- Add doctor checks:
  - missing labels/descriptions
  - invalid identifiers
  - unbounded endpoints
  - raw SQL in public semantic surfaces
  - tenant-scoped dataset missing tenant enforcement

### Acceptance Criteria

- CI can fail on breaking semantic changes.
- Teams can review semantic diffs in pull requests.
- Schema drift against ClickHouse is detected before deployment.
- Generated OpenAPI/docs/MCP schemas correspond to the same contract snapshot.

## 5. Enterprise Observability And Audit Events

Priority: P0

Change size: Medium

Primary packages: `@hypequery/serve`, `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/mcp-server`

### Current State

Serve has query logging and slow-query warnings. The ClickHouse layer has query/cache logs. Semantic result metadata can include SQL, timing, tenant, row count, and pagination. This is useful, but not yet an enterprise audit trail.

### Missing Capabilities

- Semantic audit event schema.
- Actor, tenant, policy, dataset, metric, and field correlation.
- MCP tool-call audit events.
- Policy-denied audit events.
- Query fingerprinting and SQL hash.
- Value redaction controls.
- Request ID propagation across Serve, datasets, ClickHouse, and MCP.
- Query cancellation/timeouts at semantic API level.
- Usage analytics per dataset/metric/field.

### Recommended Event Model

```ts
type SemanticAuditEvent = {
  eventType:
    | 'semantic.query.started'
    | 'semantic.query.completed'
    | 'semantic.query.failed'
    | 'semantic.policy.denied'
    | 'semantic.contract.loaded';
  requestId: string;
  actor?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    scopes?: string[];
  };
  target: {
    kind: 'dataset' | 'metric';
    name: string;
  };
  queryShape: {
    dimensions?: string[];
    measures?: string[];
    filtersCount?: number;
    limit?: number;
    by?: string;
  };
  timingMs?: number;
  rowCount?: number;
  cacheStatus?: string;
  sqlHash?: string;
};
```

### Implementation Work

- Add semantic audit hooks.
- Redact raw SQL and values by default.
- Add stable semantic query fingerprints.
- Propagate request IDs to dataset execution and ClickHouse logs.
- Add MCP source markers.
- Add docs for OpenTelemetry, Datadog, Honeycomb, and custom sinks.

### Acceptance Criteria

- Every served semantic query emits started/completed/failed events.
- Policy denials are auditable without leaking sensitive values.
- MCP calls are distinguishable from HTTP calls.
- Audit events include actor, tenant, target, query shape, timing, row count, and cache status.

## 6. Relationship-Aware Semantic Queries

Priority: P1

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Current State

`@hypequery/datasets` supports relationship metadata through `belongsTo`, `hasMany`, and `hasOne`, but current query execution is explicitly same-dataset only.

### Missing Capabilities

- Select dimensions from related datasets.
- Filter on related dataset fields.
- Group by related fields.
- Join path resolution from semantic relationship names.
- Ambiguous path detection.
- Fanout protection for `hasMany`.
- Join cardinality metadata.
- Cross-dataset metric support.
- Relationship-aware OpenAPI/React/MCP schemas.

### Recommended API Direction

```ts
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    id: dimension.string(),
    customerId: dimension.string({ column: 'customer_id' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  relationships: {
    customer: belongsTo(() => Customers, {
      from: 'customerId',
      to: 'id',
      cardinality: 'many_to_one',
      joinType: 'LEFT',
    }),
  },
});

await analytics.execute(Orders, {
  dimensions: ['customer.country'],
  measures: ['revenue'],
  filters: [
    { field: 'customer.segment', operator: 'eq', value: 'enterprise' },
  ],
});
```

### Implementation Work

- Add relationship path resolution in `@hypequery/datasets`.
- Extend `DatasetQuery` validation for relationship-qualified fields.
- Map relationship paths into ClickHouse joins.
- Reuse/bridge `@hypequery/clickhouse` join infrastructure where possible.
- Add cardinality checks:
  - `belongsTo` and `hasOne` are safe for base-table measures.
  - `hasMany` requires explicit fanout handling.
  - base-table measures must not be duplicated by many-side joins.
- Add fanout strategies:
  - reject unsafe plans by default
  - allow explicit fanout
  - pre-aggregate related dataset before joining
- Extend OpenAPI, React, and MCP metadata.

### Acceptance Criteria

- Queries across `belongsTo` relationships produce correct SQL.
- Unsafe `hasMany` plans fail with clear errors.
- Ambiguous paths fail with suggestions.
- React types and MCP schemas expose valid relationship paths only.

## 7. Rich Metric Vocabulary

Priority: P1

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Current State

Measures support `sum`, `count`, `countDistinct`, `avg`, `min`, and `max`. Metrics can reference measures or compose same-dataset base metrics through formulas.

### Missing Capabilities

- Percentiles: p50, p90, p95, p99.
- ClickHouse quantile variants.
- Approximate distinct variants.
- Filtered measures as first-class helpers.
- Ratio metrics with numerator/denominator semantics.
- Window metrics: running total, moving average, rank.
- Period-over-period metrics.
- Cumulative metrics.
- Conversion/funnel metrics.
- Retention/cohort metrics.
- Semi-additive metrics for balances/snapshots.
- Metric units and formatting.

### Recommended API Direction

```ts
const conversionRate = Orders.metric('conversionRate', {
  type: 'ratio',
  numerator: 'paidOrders',
  denominator: 'sessions',
  format: { kind: 'percent', decimals: 2 },
});

const p95Latency = Events.metric('p95Latency', {
  type: 'percentile',
  field: 'duration_ms',
  percentile: 0.95,
  method: 'tdigest',
});

const revenueWoW = revenue.compare({
  period: 'previous',
  grain: 'week',
  output: ['current', 'previous', 'delta', 'percentChange'],
});
```

### Implementation Work

- Extend measure and metric config types.
- Add planner support for each metric kind.
- Render ClickHouse functions such as `quantile`, `quantileTDigest`, `uniq`, `uniqExact`, `sumIf`, `countIf`.
- Add metric contract metadata for units, formatting, and dependencies.
- Extend OpenAPI, React result types, MCP descriptions, and docs.

### Acceptance Criteria

- Common SaaS KPIs are first-class without raw SQL formulas.
- Metric contracts expose units, formatting, and lineage.
- Unsupported metric/time combinations fail clearly.

## 8. Advanced Time Semantics

Priority: P1

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Current State

`TimeGrain` supports `day`, `week`, `month`, `quarter`, and `year`.

### Missing Capabilities

- Minute and hour grains.
- Custom intervals such as 15 minutes.
- Timezone-aware bucketing.
- Week start configuration.
- Fiscal calendars.
- Date range helpers.
- Relative time presets.
- Period filling with zero/null rows.
- ClickHouse `WITH FILL`.
- Comparison periods.

### Recommended API Direction

```ts
await analytics.execute(revenue, {
  by: {
    grain: 'hour',
    timezone: 'America/New_York',
  },
  timeRange: {
    preset: 'last_7_days',
  },
  fill: {
    missing: 'zero',
  },
});
```

### Implementation Work

- Add backward-compatible object form for `by`.
- Add `timeRange` input type.
- Render ClickHouse bucketing with timezone support.
- Add `WITH FILL` support where possible.
- Validate time ranges require dataset `timeKey`.
- Extend OpenAPI, React, MCP schemas, and docs.

### Acceptance Criteria

- Time buckets are correct for configured timezone.
- Missing buckets can be filled.
- Relative presets are validated and rendered consistently.
- Existing string grain inputs remain supported.

## 9. Query-Dependent TypeScript Result Types

Priority: P1

Change size: Medium

Primary packages: `@hypequery/datasets`, `@hypequery/serve`, `@hypequery/react`

### Current State

Serve and React carry good field-level endpoint types, but direct `analytics.execute(dataset, query)` result rows are best-effort and broad. They do not exactly reflect selected dimensions and measures.

### Missing Capabilities

- Exact row type from selected dimensions and measures.
- Exact metric value field.
- Relationship-qualified output typing.
- Type-safe filters based on field types.
- Order fields constrained to selected fields where practical.
- Broad fallback for dynamic runtime inputs.

### Recommended API Direction

```ts
const result = await analytics.queryDataset(Orders, {
  dimensions: ['region'] as const,
  measures: ['revenue'] as const,
});

// result.data[number] should be:
// { region: string; revenue: number }
```

Dynamic input should degrade intentionally:

```ts
const query = parseAgentInput(request.body);

const result = await analytics.queryDataset(Orders, query);

// result.data: Record<string, unknown>[]
```

### Implementation Work

- Add `queryDataset` overloads or improve `execute`.
- Preserve literal tuple selections.
- Generate exact row types from query literals.
- Add type tests for dimensions, measures, filters, metrics, and relationships.
- Keep type-instantiation depth reasonable for large semantic models.

### Acceptance Criteria

- Static queries produce exact output types.
- Dynamic queries compile with safe broad types.
- React hooks inherit exact types where query literals are known.

## 10. AI Tool Generation

Priority: P1

Change size: Medium

Primary packages: `@hypequery/datasets`, `@hypequery/mcp-server`, `@hypequery/serve`

### Current State

MCP exposes `list_datasets`, `get_dataset_schema`, `query_dataset`, and `query_metric`. That is useful, but there is no general-purpose API for generating tool definitions for OpenAI function calling, the Vercel AI SDK, LangChain, or application-specific agent runtimes.

### What "Tool Generation Needs Work" Means

This is not just a helper that returns one generic function. A robust implementation should generate governed, metadata-rich tool definitions from the same semantic catalog used by Serve and MCP.

Tool generation needs to support:

- Catalog mode: one generic `query_dataset` tool with dataset/dimension/measure enums.
- Per-dataset mode: one tool per dataset, such as `query_orders`.
- Per-metric mode: one tool per named metric, such as `query_revenue`.
- Adapter outputs for different runtimes:
  - OpenAI function/tool schema
  - Vercel AI SDK tools
  - MCP tools
  - plain JSON Schema plus executor
- Policy-aware schemas:
  - unauthorized fields omitted
  - tenant selection hidden by default
  - max limits reflected in schema
  - SQL hidden unless debug mode is enabled
- Agent-repairable errors:
  - invalid field
  - invalid operator
  - missing measure/dimension
  - tenant context missing
  - unsupported relationship path

### Recommended API Direction

```ts
const tools = generateDatasetTools({
  datasets: { orders: Orders },
  analytics,
  mode: 'catalog',
  runtime: {
    tenant: ({ request }) => request.auth.tenantId,
  },
  includeSql: false,
  adapter: 'openai',
});
```

Catalog tool shape:

```ts
{
  name: 'query_dataset',
  description: 'Query governed analytics datasets by selecting dimensions and measures.',
  parameters: {
    type: 'object',
    properties: {
      dataset: { type: 'string', enum: ['orders'] },
      dimensions: {
        type: 'array',
        items: { type: 'string', enum: ['status', 'createdAt', 'country'] }
      },
      measures: {
        type: 'array',
        items: { type: 'string', enum: ['revenue', 'orderCount'] }
      },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: ['status', 'createdAt', 'country'] },
            operator: { type: 'string', enum: ['eq', 'in', 'gte', 'lte'] },
            value: {}
          },
          required: ['field', 'operator', 'value']
        }
      },
      limit: { type: 'integer', minimum: 0, maximum: 1000 }
    },
    required: ['dataset']
  },
  execute: async (input) => analytics.execute(datasets[input.dataset], input)
}
```

Per-dataset mode:

```ts
const tools = generateDatasetTools({
  datasets: { orders: Orders, customers: Customers },
  analytics,
  mode: 'per-dataset',
});

// Generates:
// - query_orders
// - query_customers
```

### Implementation Work

- Build tools from the canonical catalog.
- Move MCP schema logic onto the same generator where possible.
- Add JSON Schema enum generation for dimensions, measures, filters, order fields, and grains.
- Add runtime adapters:
  - `toOpenAITools(...)`
  - `toAISDKTools(...)`
  - `toMcpTools(...)`
- Add policy/tenant hooks.
- Add tests that generated schemas reject invalid agent inputs before execution.

### Acceptance Criteria

- Tool schemas only expose valid, authorized semantic fields.
- Agent cannot choose `tenantId` by default.
- Tool execution uses the same validation as direct/Serve dataset execution.
- MCP and non-MCP agents can share the same catalog/tool metadata.

## 11. BI And Explore Query API

Priority: P1

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Current State

Dataset query input is intentionally simple: dimensions, measures, filters, order, limit, offset, and grain. It is not a full BI explore/query language.

### Missing Capabilities

- Nested AND/OR filter groups.
- Null filters.
- String operators: contains, startsWith, endsWith.
- HAVING filters on measures.
- Top-N helpers.
- Pivots.
- Drill-down and drill-through.
- Query explain/debug output.
- Saved semantic views.
- Semantic autocomplete metadata.
- Optional GraphQL or constrained SQL adapter.

### Recommended API Direction

```ts
await analytics.explore(Orders, {
  select: {
    dimensions: ['region'],
    measures: ['revenue', 'orderCount'],
  },
  where: {
    and: [
      { field: 'status', operator: 'eq', value: 'paid' },
      {
        or: [
          { field: 'region', operator: 'eq', value: 'NA' },
          { field: 'region', operator: 'eq', value: 'EMEA' },
        ],
      },
    ],
  },
  having: [
    { measure: 'revenue', operator: 'gt', value: 10000 },
  ],
});
```

Optional GraphQL adapter:

```graphql
query {
  dataset(name: "orders") {
    rows(
      dimensions: ["status"]
      measures: ["revenue"]
      limit: 100
    )
  }
}
```

Optional constrained semantic SQL:

```sql
SELECT status, revenue
FROM dataset.orders
WHERE status = 'completed'
GROUP BY status
LIMIT 100
```

### Implementation Work

- Extend filter AST.
- Add HAVING support.
- Add explain output:
  - selected fields
  - relationship paths
  - generated SQL or SQL hash
  - policy filters
  - tenant filters
  - cache key/fingerprint
- Add saved semantic views.
- Add MCP tool for `explain_dataset_query`.
- Decide whether GraphQL/constrained SQL are product goals or integrations.

### Acceptance Criteria

- Complex filters validate and render safely.
- HAVING filters only apply to valid measures.
- Explain output is safe to expose with SQL redaction controls.
- Saved views have contracts and can be served like datasets.

## 12. Semantic Caching And Acceleration

Priority: P1

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/serve`, `@hypequery/schema`

### Current State

The ClickHouse query builder has cache support, cache providers, cache keys, tags, invalidation, warming, stale behavior, and cache status logs. Serve has endpoint cache headers. Semantic dataset/metric concepts are not deeply integrated into cache keys, invalidation, freshness, or rollup selection.

### Missing Capabilities

- Semantic query fingerprinting.
- Dataset/metric cache tags.
- Tenant-aware and policy-aware cache keys.
- Cache invalidation by dataset/metric.
- Freshness metadata.
- Aggregate table/rollup awareness.
- Semantic cache warmers.
- Audit events with cache status.

### Recommended API Direction

```ts
const Orders = dataset('orders', {
  source: 'orders',
  cache: {
    ttlMs: 60_000,
    tags: ['orders'],
    varyBy: ['tenant', 'policy'],
  },
});
```

Query-level override:

```ts
await analytics.execute(Orders, {
  dimensions: ['status'],
  measures: ['revenue'],
  cache: {
    ttlMs: 30_000,
    tags: ['orders', 'orders:revenue'],
  },
});
```

### Implementation Work

- Add semantic fingerprint generation.
- Include tenant, policy, selected fields, filters, grain, and runtime context in cache keys.
- Add dataset/metric tags.
- Add invalidation/warming APIs at Serve or dataset-client level.
- Surface cache status in semantic metadata and audit events.
- Document distributed cache provider patterns.

### Acceptance Criteria

- Cache never leaks across tenants or policies.
- Semantically equivalent queries produce stable fingerprints.
- Operators can invalidate by dataset or metric.
- Audit events include cache status.

## 13. Materialized View And Rollup Planner

Priority: P2

Change size: Major

Primary packages: `@hypequery/schema`, `@hypequery/datasets`, `@hypequery/clickhouse`, `@hypequery/cli`

### Current State

`@hypequery/schema` has materialized-view snapshot and diff concepts. The semantic layer does not yet define rollups or rewrite semantic queries to aggregate tables/materialized views.

### Missing Capabilities

- Rollup definitions attached to semantic models.
- Generated ClickHouse materialized views.
- Generated aggregate target tables.
- Query rewrite to rollups.
- Freshness/staleness checks.
- Backfill workflows.
- CI checks for rollup compatibility.

### Recommended API Direction

```ts
const OrdersDailyRollup = rollup(Orders, {
  grain: 'day',
  dimensions: ['region', 'plan'],
  measures: ['revenue', 'orderCount'],
  refresh: {
    strategy: 'materialized_view',
  },
});
```

### Implementation Work

- Define rollup contracts.
- Generate ClickHouse DDL through `@hypequery/schema`.
- Add semantic query planner rewrite rules.
- Track rollup freshness.
- Add backfill scripts/CLI.

### Acceptance Criteria

- Rollup SQL is generated from semantic contracts.
- Query planner picks rollup only when semantically equivalent.
- Freshness metadata is exposed.
- Backfills are documented and scriptable.

## 14. Semantic Package And Codegen Ecosystem

Priority: P2

Change size: Medium

Primary packages: `@hypequery/cli`, `@hypequery/serve`, `@hypequery/react`, `@hypequery/mcp-server`

### Missing Capabilities

- Generated typed client package.
- Generated route manifest package.
- Generated MCP config.
- Generated agent tool definitions.
- Generated docs site section.
- Semantic model publishing workflow.

### Recommended CLI Direction

```bash
hypequery semantic generate-client --target react
hypequery semantic generate-tools --target openai
hypequery semantic generate-mcp-config
hypequery semantic generate-docs
```

### Acceptance Criteria

- Client applications do not need to import server code.
- Generated clients are pinned to semantic contract versions.
- MCP config and generated tools are policy-aware and safe by default.

## 15. Tenant-Specific Dynamic Views And Registries

Priority: P2

Change size: Major

Primary packages: `@hypequery/datasets`, `@hypequery/serve`, `@hypequery/mcp-server`, `@hypequery/cli`

### Current State

Tenant isolation exists for data access through tenant runtime and dataset `tenantKey`. Tenant-specific custom views or metric overlays are a different requirement.

### Missing Capabilities

- Runtime dataset registry abstraction.
- Tenant-scoped dataset overlays.
- Tenant-specific saved measures/views.
- Policy-validated custom views.
- Cache of resolved tenant catalogs.
- Safe expression restrictions for untrusted tenant-authored definitions.

### Recommended API Direction

```ts
const registry = createDatasetRegistry({
  base: {
    orders: Orders,
  },
  overlays: async ({ tenantId }) => {
    return loadTenantDatasetOverrides(tenantId);
  },
});

const tenantOrders = await registry.get('orders', {
  tenantId: 'tenant_123',
});
```

Example overlay:

```json
{
  "hiddenDimensions": ["internalStatus"],
  "savedMeasures": {
    "netRevenue": {
      "formula": "revenue - refunds"
    }
  },
  "defaultLimit": 500
}
```

### Acceptance Criteria

- Tenant overlays cannot introduce unsafe SQL unless explicitly trusted.
- Resolved tenant catalogs are policy-aware and cacheable.
- Saved tenant views can be validated and served like first-class semantic contracts.

## Package Impact Matrix

| Package | Expected Impact | Notes |
|---|---:|---|
| `@hypequery/datasets` | High | Core model, validation, planning, catalog, metrics, relationships, policies, contracts. |
| `@hypequery/clickhouse` | High | SQL rendering, safe identifiers, relationship joins, ClickHouse functions, rollups, cache integration. |
| `@hypequery/serve` | High | Policy-aware endpoints, OpenAPI schemas, auth integration, audit events, semantic metadata. |
| `@hypequery/react` | Medium | Exact query/result types, explore hooks, manifest consumption, generated clients. |
| `@hypequery/cli` | High | Semantic validation, snapshot/diff, codegen, schema drift checks, docs/tool generation. |
| `@hypequery/schema` | Medium-High | Contract lifecycle, ClickHouse compatibility, migrations, materialized views, rollups. |
| `@hypequery/mcp-server` | Medium-High | Safe introspection, tool generation, policy-aware metadata, explain tools, audit events. |
| `website-next` | Medium | Enterprise docs, semantic contracts, trust boundaries, examples, migration guides. |
| Examples | Medium | Multi-tenant SaaS, embedded analytics, governed MCP, dashboard builder, rollups. |

## Recommended Delivery Plan

### Immediate Priority Stack

The fastest path is to prove the current same-dataset semantic surface as a dependable product surface before expanding the planner. That means metadata consistency, agent/dashboard usability, and enterprise trust boundaries come before relationship joins and rollups.

1. Catalog/introspection unification.
2. MCP schema fix for measures vs metrics.
3. Dashboard-builder metadata.
4. AI tool generation from the catalog.
5. Semantic audit events.
6. CLI dataset-generation improvements.
7. Query-dependent result types.
8. Semantic governance and field policies.
9. Semantic contract snapshots and validation CLI.
10. `belongsTo` relationship traversal MVP.
11. Rich metric vocabulary.
12. Advanced time semantics.
13. BI/explore API.
14. Semantic cache fingerprints and invalidation.
15. Rollups/materialized views.

This differs slightly from a pure enterprise-risk order. Governance is essential, but catalog/tool/dashboard work is the highest leverage first because it consolidates the surfaces that governance will later filter.

### Phase 1: Product Surface Baseline

Target: make the existing dynamic dataset surface coherent and useful for agents and dashboard builders.

Includes:

1. Catalog/introspection unification.
2. MCP measures/metrics schema fix.
3. Dashboard-builder metadata.
4. AI tool generation.
5. CLI generation improvements.

Status:

- Complete in this PR: catalog/introspection unification, MCP measures/metrics schema fix, dashboard-builder metadata, Serve/OpenAPI catalog consumption, and initial AI tool generation.
- Remaining: CLI generation improvements and broader cross-package drift tests.

Why first: this creates one shared semantic contract for docs, Serve, MCP, generated tools, and dashboard UIs. It also produces visible product value without changing the SQL planner.

### Phase 2: Enterprise Safety Baseline

Target: make the existing dynamic dataset surface safe, governable, auditable, and consistent.

Includes:

1. Trust-boundary docs and unsafe SQL naming audit.
2. Semantic audit events.
3. Semantic contract JSON export.
4. `hypequery semantic validate`.
5. Dataset/dimension/measure/metric access policies.
6. Policy-aware catalog/docs/tools.
7. Safe semantic expression primitives.

Why first: enterprise buyers need governance, correctness, and auditability before advanced analytics features.

### Phase 3: Relationship And Cross-Dataset Semantics

Target: model real business domains across tables.

Includes:

1. Relationship path resolution.
2. Relationship-qualified fields.
3. Fanout-safe planning.
4. Cross-dataset filters and dimensions.
5. OpenAPI/React/MCP metadata for relationships.

Why second: this is the visible leap from dataset endpoints to a true semantic layer.

### Phase 4: Rich Metrics And Time Intelligence

Target: support common enterprise KPI definitions without raw SQL.

Includes:

1. Ratio, percentile, approximate distinct, cumulative, and period-over-period metrics.
2. Advanced time grains, timezones, relative ranges, and fill.
3. Metric formatting and units.
4. Metric lineage and dependency graph.

### Phase 5: Explore And Client Ecosystem

Target: make datasets usable by dashboard builders, agents, and frontend apps without importing server code.

Includes:

1. BI/explore query API.
2. Query-dependent result typing.
3. Generated typed clients.
4. Generated docs/MCP/tool configs.

### Phase 6: Scale And Acceleration

Target: optimize ClickHouse workloads at semantic level.

Includes:

1. Semantic cache keys and invalidation.
2. Rollup/materialized view definitions.
3. Query rewrite to aggregate tables.
4. Freshness and backfill workflows.

## Suggested First PRs

| PR | Status | Scope | Packages | Change Size | Reason |
|---|---|---|---|---:|---|
| 1 | Complete | Catalog export, MCP introspection fix, Serve/OpenAPI catalog metadata, dashboard/tool metadata, and initial AI tool generation | `datasets`, `mcp-server`, `serve`, `website-next` | Medium | Fixes agent/dashboard metadata, removes measures/metrics drift, and gives agents catalog-backed tool schemas. |
| 2 | Complete in this PR | Trust-boundary docs and unsafe SQL audit | `website-next`, `datasets`, `clickhouse`, `cli` | Minor | Low-risk enterprise/security foundation. |
| 3 | Next | Semantic contract JSON export | `datasets`, `serve` | Medium | Enables validation, snapshots, docs, MCP, and codegen to share one source. |
| 4 | Next | `hypequery semantic validate` CLI | `cli`, `datasets`, `schema` | Medium | Immediate CI value. |
| 5 | Planned | Semantic audit event hooks | `serve`, `datasets`, `mcp-server` | Medium | Required for enterprise deployment. |
| 6 | Planned | Field/dataset/metric access metadata | `datasets`, `serve` | Major | Starts governance before relationship complexity. |
| 7 | Planned | Safe expression primitives MVP | `datasets`, `clickhouse` | Major | Reduces SQL safety risk before expanding planner. |
| 8 | Planned | `belongsTo` relationship traversal MVP | `datasets`, `clickhouse`, `serve`, `react` | Major | First visible cross-dataset semantic capability. |

## Key Risks

### TypeScript Type Complexity

Relationship-aware fields and query-dependent result types can create deep conditional types. Keep helper types shallow, add escape hatches for dynamic queries, and maintain type tests against large models.

### Fanout Bugs

Cross-dataset joins are the highest correctness risk. Default behavior should reject unsafe many-side joins unless the user explicitly chooses a safe strategy.

### SQL Safety

Raw SQL is necessary for ClickHouse power users, but it must be clearly separated from safe semantic expressions. Enterprise users need auditable trust boundaries.

### Backward Compatibility

Existing APIs should continue to work:

- Current `dataset()` definitions should remain valid.
- String `TimeGrain` should remain valid while object-based time config is added.
- Current `sql` fields should continue to work but be documented as trusted-code escape hatches.
- Current dataset query shape should remain supported while richer explore APIs are introduced.

### Schema Drift Across Surfaces

Zod schemas, TypeScript types, route manifests, MCP schemas, tool schemas, OpenAPI, and docs should be generated from the same semantic contract wherever possible.

## Definition Of Enterprise Ready

Hypequery should be considered enterprise-ready as a ClickHouse semantic layer when:

- Semantic models can span related datasets safely.
- Metrics and fields have enforceable access policies.
- User-facing query input cannot inject raw SQL.
- Semantic contracts can be snapshotted, diffed, and validated in CI.
- Schema drift against ClickHouse is detectable.
- Audit logs identify who queried what, under which tenant/policy, and with which semantic fields.
- OpenAPI, React, MCP, docs, and generated tools use the same contract.
- Common KPI patterns do not require raw SQL.
- Timezone-aware time-series analytics are supported.
- Semantic cache keys are tenant- and policy-safe.
- Large deployments have a path to rollups/materialized views.

## Non-Goals For The Immediate Roadmap

- Becoming a general-purpose BI frontend.
- Supporting every database backend equally.
- Removing raw SQL escape hatches.
- Automatically solving every ClickHouse performance problem.
- Replacing dbt transformations.

The near-term goal should be narrower and stronger: Hypequery should be the best TypeScript-native governed semantic API layer for ClickHouse applications.
