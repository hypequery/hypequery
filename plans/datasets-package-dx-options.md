# Datasets Package DX and Package Structure Options

## Context

`@hypequery/datasets` is pre-release, so we can still make breaking changes to its public API. The constraint is that the existing root `@hypequery/clickhouse` API should not break. Existing ClickHouse users should still be able to import and use:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
```

The goal is to make semantic datasets feel first-class without forcing users to understand the lower-level query builder. The awkward current smell is this:

```ts
import { createExecutor, dataset } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

const queryBuilder = createQueryBuilder(clickhouseConfig);
const analytics = createExecutor({ queryBuilder });
```

That is architecturally clean, but it leaks an implementation detail into the datasets-first workflow. A user who wants to define and query datasets should not have to think "I need a query builder" before they can run a semantic query.

## Current Package Roles

Today the clean conceptual split is:

```txt
@hypequery/datasets
  Owns semantic definitions:
  - dataset()
  - dimension()
  - measure()
  - metric refs
  - filters/order helpers
  - semantic query validation
  - generic semantic query planning/execution protocol

@hypequery/clickhouse
  Owns ClickHouse runtime:
  - createQueryBuilder()
  - ClickHouse adapter/client config
  - SQL rendering/execution
  - ClickHouse-specific query builder features

@hypequery/serve
  Owns HTTP/runtime delivery:
  - createAPI()
  - generated metric/dataset endpoints
  - auth/tenant/runtime integration

@hypequery/mcp
  Owns MCP delivery:
  - list datasets
  - introspect datasets
  - query metrics/datasets through a semantic executor
```

This structure is good at the architecture level. `@hypequery/datasets` should not directly know how to connect to ClickHouse. It should define a semantic model and a generic execution protocol. ClickHouse should provide the concrete database runtime.

The DX question is whether users should see that protocol boundary in normal application code.

## Boundary Invariant

The package topology only works if the execution boundary is real:

```txt
@hypequery/datasets may know that a query backend exists.
@hypequery/datasets must not know that ClickHouse exists.
```

Those are different. The first is an interface owned by datasets. The second is
a database dependency or dialect assumption.

The hard invariant is:

```txt
datasets owns:
  - semantic authoring helpers
  - normalized semantic contracts
  - semantic query planning into a structural IR
  - backend interfaces

database packages own:
  - dialect rendering
  - SQL generation
  - connection/client config
  - query execution
```

This means `@hypequery/datasets` must not import `@hypequery/clickhouse`,
`@clickhouse/client`, or ClickHouse type/config symbols. It also means datasets
must not emit ClickHouse SQL as its semantic plan. A semantic plan can say:

```ts
{
  kind: 'aggregate',
  source: 'orders',
  grain: { field: 'created_at', unit: 'month', output: 'period' },
  aggregations: [{ name: 'revenue', aggregation: 'sum', field: 'amount' }],
}
```

It must not say:

```ts
{
  select: ['toStartOfMonth(created_at) AS period', 'SUM(amount) AS revenue'],
}
```

The ClickHouse package maps the first shape to the second. That is the point of
the boundary.

## Canary Test

The canary for this architecture is an in-memory backend:

```ts
const executor = createExecutor({
  backend: createInMemoryBackend({
    orders: [
      { id: '1', country: 'US', amount: 100, status: 'completed' },
      { id: '2', country: 'DE', amount: 75, status: 'completed' },
    ],
  }),
});

await executor.dataset(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});
```

This test must live in `@hypequery/datasets` and must pass with no ClickHouse
package installed. If it becomes hard to write, datasets has started leaning on
ClickHouse again.

The in-memory backend is not intended as a production analytics engine. It is a
reference backend and architectural regression guard.

## Three Artifacts

Keep these layers separate:

```txt
Authoring objects
  Ergonomic API. May have methods:
  - dataset()
  - Orders.metric()
  - metric.by()
  - metric.contract()
  - relationship target functions

Contract POJOs
  Normalized, serializable model shape.
  No methods.
  Validated at the authoring -> contract boundary.
  Used by MCP, serve, docs, schema checks, and cross-package/process boundaries.

Plan nodes
  A structural semantic query against a contract.
  No methods.
  No SQL strings.
  Executed by a SemanticBackend.
```

The current implementation has started this split with `PlanNode` and
`SemanticBackend`, but the contract POJO normalization should remain a separate
workstream. Do not confuse "authoring object is a plain JS object" with "contract
is serializable." Authoring objects can be convenient. Contracts and plans must
be portable.

## IR Scope

The semantic IR should be closed and intentionally small. For the current shipped
surface, the minimum node set is:

```ts
type PlanNode =
  | { kind: 'aggregate'; ... }
  | { kind: 'derive'; input: PlanNode; ... };
```

Do not add join or period-comparison nodes until those features are actually
supported end to end. A closed set that is fully covered is better than an open
set that invites raw SQL escape hatches.

The semantic layer already has a sanctioned escape hatch one level down: users
can use the raw ClickHouse query builder for database-specific queries. That is
why the semantic IR should stay strict and should not grow a `sql?: string`
field.

Future node candidates:

```ts
type PlanNode =
  | { kind: 'aggregate'; ... }
  | { kind: 'derive'; input: PlanNode; ... }
  | { kind: 'periodComparison'; input: PlanNode; ... }
  | { kind: 'join'; left: PlanNode; right: PlanNode; relationship: RelationshipRef };
```

Only add these when there is a real feature and both the in-memory backend and
ClickHouse backend can execute the node.

## Current Architecture Status

As of this note, the desired architecture is partially implemented:

```txt
Done:
  - datasets has no ClickHouse package dependency
  - datasets defines PlanNode and SemanticBackend
  - datasets has an in-memory backend canary
  - createExecutor can execute through a semantic backend
  - @hypequery/clickhouse/datasets can execute PlanNode through ClickHouse

Still to do:
  - retire the legacy QueryBuilderLike execution path from public datasets APIs
  - move remaining SQL helper assumptions out of datasets internals
  - normalize authoring objects into serializable contract POJOs
  - make the ClickHouse semantic backend the only path used by createDatasetClient
  - decide when the experimental subpath becomes the default documented path
```

The package topology can be Option A, but the portability/multi-adapter claim is
only fully true once the legacy SQL/query-builder path is removed or made
strictly internal compatibility code.

## Current Implementation Direction

The implemented cleanup adds a generic semantic executor in `@hypequery/datasets`:

```ts
import { createExecutor } from '@hypequery/datasets';

const executor = createExecutor({ queryBuilder });

await executor.metric(revenue, {
  dimensions: ['country'],
});

await executor.dataset(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});
```

It also adds a ClickHouse convenience subpath:

```ts
import { createDatasetClient } from '@hypequery/clickhouse/datasets';

const analytics = createDatasetClient(clickhouseConfig);

await analytics.metric(revenue, {
  dimensions: ['country'],
});
```

This removes the visible `createQueryBuilder()` step for users who choose the ClickHouse datasets entrypoint.

## The Remaining DX Concern

Even with `@hypequery/clickhouse/datasets`, the user may still need two packages:

```bash
pnpm add @hypequery/clickhouse @hypequery/datasets
```

and imports may still be split:

```ts
import { createDatasetClient } from '@hypequery/clickhouse/datasets';
import { dataset, dimension, measure, eq } from '@hypequery/datasets';
```

That is logically correct, but it can feel odd. A ClickHouse datasets user may reasonably expect one install and one import surface:

```bash
pnpm add @hypequery/clickhouse
```

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
} from '@hypequery/clickhouse/datasets';
```

This is likely the best default DX for ClickHouse users.

## Recommended Direction

Make `@hypequery/clickhouse/datasets` the one-stop semantic ClickHouse entrypoint.

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
  desc,
} from '@hypequery/clickhouse/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });

const analytics = createDatasetClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE!,
});

const result = await analytics.metric(revenue, {
  dimensions: ['country'],
  filters: [eq('status', 'completed')],
  orderBy: [desc('revenue')],
});

const datasetResult = await analytics.dataset(Orders, {
  dimensions: ['country'],
  measures: ['revenue', 'orderCount'],
});
```

In this model:

- `@hypequery/datasets` remains the pure semantic core.
- `@hypequery/clickhouse/datasets` re-exports the semantic helpers from `@hypequery/datasets`.
- `@hypequery/clickhouse/datasets` adds `createDatasetClient(config)`.
- ClickHouse users can install only `@hypequery/clickhouse`.
- Advanced/integration users can still install and use `@hypequery/datasets` directly.

The package graph becomes:

```txt
@hypequery/clickhouse
  depends on @hypequery/datasets
  exposes:
    ".": existing query builder API
    "./datasets": semantic ClickHouse API

@hypequery/datasets
  no dependency on @hypequery/clickhouse
  exposes pure semantic model + generic executor
```

This preserves the important direction of dependency:

```txt
ClickHouse adapter -> semantic core
semantic core -/-> ClickHouse adapter
```

That is the right coupling. Database-specific packages can depend on the semantic core. The semantic core should not depend on database-specific packages.

## Option A: ClickHouse Owns the Best DX

### Install

```bash
pnpm add @hypequery/clickhouse
```

### Imports

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
} from '@hypequery/clickhouse/datasets';
```

### Package Link

```txt
@hypequery/clickhouse
  dependency: @hypequery/datasets

@hypequery/datasets
  dependency: none on ClickHouse
```

### Pros

- Best DX for the product’s current primary database.
- One install for ClickHouse semantic analytics.
- One import path for common examples.
- Keeps root `@hypequery/clickhouse` API stable.
- Keeps semantic core reusable.
- Makes docs simpler: "Using ClickHouse? Import from `@hypequery/clickhouse/datasets`."

### Cons

- `@hypequery/clickhouse` now includes `@hypequery/datasets` as a dependency even for users who only want the query builder.
- The ClickHouse package becomes a broader product surface, not only a query builder package.
- Need to be careful that `@hypequery/clickhouse/datasets` does not accidentally leak into the root entrypoint.

### Assessment

This is the most pragmatic choice. `@hypequery/datasets` is small, and the dependency direction is healthy. The cost is a slightly larger ClickHouse install; the benefit is much clearer DX.

## Option B: Keep Datasets as an Optional Peer

### Install

```bash
pnpm add @hypequery/clickhouse @hypequery/datasets
```

### Imports

```ts
import { createDatasetClient } from '@hypequery/clickhouse/datasets';
import { dataset, dimension, measure } from '@hypequery/datasets';
```

### Package Link

```txt
@hypequery/clickhouse
  optional peer: @hypequery/datasets
  dev dependency: @hypequery/datasets

@hypequery/datasets
  dependency: none on ClickHouse
```

### Pros

- Keeps `@hypequery/clickhouse` lean for query-builder-only users.
- Makes the optional nature of semantic datasets explicit.
- Avoids bundling semantic APIs into every ClickHouse install.
- Maintains a clean package boundary.

### Cons

- Worse first-run DX.
- Users must understand why two packages are needed.
- Docs need to explain the split repeatedly.
- More room for peer dependency/version mismatch.
- The import story feels fragmented.

### Assessment

This is architecturally tidy but product-weaker. It optimizes for package purity over the path most users will probably take.

## Option C: Separate Integration Package

### Install

```bash
pnpm add @hypequery/datasets-clickhouse
```

or:

```bash
pnpm add @hypequery/datasets @hypequery/clickhouse @hypequery/datasets-clickhouse
```

### Imports

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
} from '@hypequery/datasets-clickhouse';
```

### Package Link

```txt
@hypequery/datasets-clickhouse
  depends on @hypequery/datasets
  depends on @hypequery/clickhouse

@hypequery/datasets
  dependency: none on ClickHouse

@hypequery/clickhouse
  dependency: none on datasets
```

### Pros

- Cleanest theoretical dependency graph.
- Keeps `@hypequery/clickhouse` focused on query building.
- Gives each adapter its own integration package.
- Scales if there will be many database adapters.

### Cons

- Adds another package name users must discover.
- More release/version coordination.
- More docs surface.
- Feels heavy while datasets is pre-release.
- May make Hypequery feel more fragmented than it needs to be.

### Assessment

This is attractive if Hypequery quickly becomes multi-database. It is probably premature if ClickHouse is the main product path today.

## Option D: Put Everything in `@hypequery/datasets`

### Install

```bash
pnpm add @hypequery/datasets
```

### Imports

```ts
import {
  createClickHouseDatasetClient,
  dataset,
  dimension,
  measure,
} from '@hypequery/datasets/clickhouse';
```

### Package Link

```txt
@hypequery/datasets
  depends on @hypequery/clickhouse
```

### Pros

- Nice if the user thinks "I am using datasets" first.
- One conceptual package for semantic analytics.
- Makes the semantic package feel complete.

### Cons

- Wrong dependency direction.
- Semantic core becomes tied to ClickHouse.
- Model-only users pull in database runtime dependencies.
- Future adapters become awkward.
- Higher risk of circular package relationships.

### Assessment

Avoid this. It solves the visible install/import issue by weakening the architecture.

## Option E: Attach Execution to Dataset and Metric Objects

### DX

```ts
const analytics = createDatasetClient(config);

const Orders = dataset('orders', { ... }).connect(analytics);
const revenue = Orders.metric('revenue', { measure: 'revenue' });

await revenue.run({ dimensions: ['country'] });
await Orders.query({ measures: ['revenue'] });
```

### Pros

- Very demo-friendly.
- Reads naturally in small examples.
- Minimizes explicit executor/client passing.

### Cons

- Mixes semantic definitions with runtime state.
- Harder for request-scoped tenancy.
- Harder for serverless/runtime-specific builders.
- Harder for tests and model reuse.
- Model objects become less portable for docs, schema compatibility, MCP, and serve.
- Encourages hidden state.

### Assessment

Avoid as the primary API. It looks good in snippets but creates long-term friction.

## Naming Choices

### `createExecutor`

Good for generic `@hypequery/datasets`:

```ts
const executor = createExecutor({ queryBuilder });
await executor.metric(revenue, query);
await executor.dataset(Orders, query);
```

Pros:

- Short.
- Matches the existing `MetricExecutor` vocabulary.
- Works for tests, serve, MCP, and generic integrations.

Cons:

- Slightly technical.
- Does not say "analytics" or "semantic".

### `createDatasetClient`

Good for `@hypequery/clickhouse/datasets`:

```ts
const analytics = createDatasetClient(config);
```

Pros:

- Reads as a user-facing client.
- Hides query builder internals.
- Matches a database-specific connection/config mental model.

Cons:

- The returned client can query metrics too, not only datasets.

### `createSemanticClient`

Possible alternative:

```ts
const semantic = createSemanticClient(config);
```

Pros:

- More accurate than dataset-only naming.
- Aligns with "semantic layer" language.

Cons:

- More abstract.
- Less obvious for users who just want dataset queries.

### Recommendation

Use both names at different layers:

```txt
@hypequery/datasets
  createExecutor()

@hypequery/clickhouse/datasets
  createDatasetClient()
```

The generic package exposes a generic executor. The database-specific package exposes a user-facing client.

## Public API Recommendation

### `@hypequery/datasets`

```ts
export {
  dataset,
  dimension,
  measure,
  eq,
  desc,
  createExecutor,
};

export type {
  DatasetQuery,
  DatasetQueryResult,
  MetricQuery,
  MetricResult,
  SemanticExecutor,
};
```

Usage:

```ts
const executor = createExecutor({ queryBuilder });

await executor.metric(revenue, query);
await executor.dataset(Orders, query);
```

### `@hypequery/clickhouse/datasets`

```ts
export {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
  desc,
};
```

Usage:

```ts
const analytics = createDatasetClient(clickhouseConfig);

await analytics.metric(revenue, query);
await analytics.dataset(Orders, query);
```

## Migration Notes From Current Pre-Release API

Current old-ish style:

```ts
import { MetricExecutor } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

const queryBuilder = createQueryBuilder(config);
const executor = new MetricExecutor({ builderFactory: queryBuilder });

await executor.run(revenue, query);
```

Generic replacement:

```ts
import { createExecutor } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

const queryBuilder = createQueryBuilder(config);
const executor = createExecutor({ queryBuilder });

await executor.metric(revenue, query);
```

Best ClickHouse replacement:

```ts
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
} from '@hypequery/clickhouse/datasets';

const analytics = createDatasetClient(config);

await analytics.metric(revenue, query);
```

## Open Questions

1. Should `@hypequery/clickhouse/datasets` re-export every public helper from `@hypequery/datasets`, or only the most common definition/query helpers?

   Recommendation: re-export the full public semantic surface. Partial re-exports create unnecessary confusion.

2. Should `MetricExecutor` remain exported during pre-release?

   Recommendation: remove or mark internal before release. If we are comfortable breaking datasets API now, keeping old names may slow convergence.

3. Should the client method be `dataset(...)` or `query(...)`?

   Recommendation: use `dataset(ds, query)` for symmetry with `metric(metric, query)`. Consider adding `queryDataset` only if user testing shows `dataset(...)` reads oddly.

4. Should the ClickHouse datasets subpath be documented as the default path?

   Recommendation: yes. For ClickHouse users, docs should lead with `@hypequery/clickhouse/datasets`. The generic `@hypequery/datasets` executor should be documented as advanced/integration API.

5. Should `@hypequery/serve` import from the generic executor or the ClickHouse client?

   Recommendation: generic executor. `serve` should remain database-agnostic and accept `queryBuilder` or a semantic executor internally.

## Final Recommendation

Adopt Option A:

```txt
@hypequery/clickhouse
  root API unchanged
  depends on @hypequery/datasets
  adds @hypequery/clickhouse/datasets
  re-exports datasets helpers from that subpath
  exposes createDatasetClient(config)

@hypequery/datasets
  remains pure semantic core
  exposes createExecutor({ queryBuilder })
```

This balances architecture and DX:

- The semantic core stays portable.
- ClickHouse users get one install and one import path.
- Existing root ClickHouse query-builder users are unaffected.
- Serve and MCP keep a generic executor boundary.
- Future database adapters can copy the same pattern:

```txt
@hypequery/postgres/datasets
@hypequery/bigquery/datasets
@hypequery/snowflake/datasets
```

Each database package can own its best native DX while sharing the same semantic core.
