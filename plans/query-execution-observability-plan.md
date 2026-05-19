# Query Execution Observability Plan

## Goal

Preserve the implementation context for wiring query execution tracking across:

1. `@hypequery/serve`
2. `@hypequery/datasets`
3. `@hypequery/clickhouse`

This is primarily about making logs and telemetry coherent across the request layer, semantic layer, and database execution layer, with a path to cloud tracing later.

## Current Architecture

The current layering is broadly sensible:

```text
HTTP request
  -> @hypequery/serve endpoint pipeline
  -> semantic metric / dataset execution
  -> clickhouse query builder / adapter
  -> ClickHouse
```

Responsibilities today:

- `@hypequery/serve`
  - request lifecycle
  - auth / tenant resolution
  - endpoint routing
  - request-level logging
- `@hypequery/datasets`
  - semantic query validation
  - metric and dataset planning
  - SQL construction via a query-builder protocol
- `@hypequery/clickhouse`
  - query execution
  - cache behavior
  - DB-level query logging
  - adapter boundary to ClickHouse

This separation makes sense. The main gap is not package ownership, but context propagation.

## What Already Exists

### Serve Layer

`@hypequery/serve` already has request-level lifecycle tracking.

Relevant files:

- [packages/serve/src/pipeline.ts](/Users/lukereilly/repos/hypequery-core/packages/serve/src/pipeline.ts)
- [packages/serve/src/query-logger.ts](/Users/lukereilly/repos/hypequery-core/packages/serve/src/query-logger.ts)
- [packages/serve/src/types.ts](/Users/lukereilly/repos/hypequery-core/packages/serve/src/types.ts)

What exists:

- `requestId` generation and propagation to response headers
- request lifecycle hooks:
  - `onRequestStart`
  - `onRequestEnd`
  - `onError`
  - auth failure hooks
- `ServeQueryLogger` events:
  - `started`
  - `completed`
  - `error`

This is a good request envelope.

### ClickHouse Layer

`@hypequery/clickhouse` already has execution-level logging and a query correlation seam.

Relevant files:

- [packages/clickhouse/src/core/features/executor.ts](/Users/lukereilly/repos/hypequery-core/packages/clickhouse/src/core/features/executor.ts)
- [packages/clickhouse/src/core/utils/logger.ts](/Users/lukereilly/repos/hypequery-core/packages/clickhouse/src/core/utils/logger.ts)
- [packages/clickhouse/src/core/adapters/clickhouse-adapter.ts](/Users/lukereilly/repos/hypequery-core/packages/clickhouse/src/core/adapters/clickhouse-adapter.ts)
- [packages/clickhouse/src/core/cache/cache-manager.ts](/Users/lukereilly/repos/hypequery-core/packages/clickhouse/src/core/cache/cache-manager.ts)

What exists:

- `ExecutorFeature.execute()` accepts:
  - `queryId`
  - `logContext`
- query logs are emitted at execution time
- `queryId` is forwarded to ClickHouse as `query_id`
- cache hit/miss/revalidate paths also emit query logs

This is the right seam for DB-level observability.

### Semantic Layer

The semantic layer already depends on a protocol rather than directly depending on `@hypequery/clickhouse`.

Relevant files:

- [packages/datasets/src/query-builder-protocol.ts](/Users/lukereilly/repos/hypequery-core/packages/datasets/src/query-builder-protocol.ts)
- [packages/datasets/src/executor.ts](/Users/lukereilly/repos/hypequery-core/packages/datasets/src/executor.ts)

This is the correct architectural direction. `@hypequery/datasets` should depend on interfaces, not on the ClickHouse package itself.

## Main Observability Gap

The semantic layer currently drops execution metadata.

### Current problem

`@hypequery/serve` generates a `requestId`, but it is not passed into semantic execution.

`MetricExecutor.run()` currently accepts only:

- `tenantId`

and then calls:

- `builder.execute()`
- `builderFactory.rawQuery()`

without passing correlation metadata through.

The dataset endpoint in `@hypequery/serve` also executes directly against the builder without a request-level correlation ID.

### Result

Today we have:

- request logs at the `serve` layer
- DB/query logs at the `clickhouse` layer

but no guaranteed way to join them.

That means:

- logs are still useful
- but they are mostly useful in isolation
- end-to-end tracing is not wired

## Why This Matters Even Without Cloud

Even before a cloud product exists, this is still useful:

- local debugging
- self-hosted observability
- support investigations
- performance analysis
- cache behavior debugging

Without correlation:

- `serve` can tell us an endpoint was slow
- `clickhouse` can tell us a SQL query was slow
- but we cannot reliably map one to the other

That is still useful, but incomplete.

## Architectural Recommendation

Do **not** make `@hypequery/datasets` depend directly on `@hypequery/clickhouse`.

Do **not** import the concrete query builder package into the semantic package.

Instead:

- keep `semantic` dependent on a protocol
- widen that protocol so execution metadata can flow through
- have `clickhouse` implement the richer protocol
- have `serve` inject request-level context into semantic execution

This preserves DB-agnostic design while enabling observability.

## Recommended Design

Introduce a shared execution metadata object that can move through all three layers.

Suggested shape:

```ts
interface ExecutionMetadata {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  queryId?: string;
  endpointKey?: string;
  tenantId?: string;
  semanticEntityType?: 'metric' | 'dataset';
  semanticEntityName?: string;
}
```

This does not need full tracing semantics immediately. The minimum practical version can start with:

- `requestId`
- `queryId`
- `endpointKey`
- `tenantId`
- `semanticEntityType`
- `semanticEntityName`

## Protocol Changes

The current semantic protocol is too narrow:

```ts
interface QueryBuilderLike {
  execute(): Promise<Record<string, unknown>[]>;
}

interface QueryBuilderFactoryLike {
  rawQuery<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
```

It should be expanded to allow execution metadata:

```ts
interface QueryExecutionOptionsLike {
  metadata?: ExecutionMetadata;
}

interface QueryBuilderLike {
  execute(options?: QueryExecutionOptionsLike): Promise<Record<string, unknown>[]>;
}

interface QueryBuilderFactoryLike {
  rawQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: QueryExecutionOptionsLike
  ): Promise<T[]>;
}
```

Then `@hypequery/clickhouse` can map:

- `metadata.queryId` -> ClickHouse `query_id`
- metadata fields -> logger `logContext`

## Serve-Layer Changes

`@hypequery/serve` should remain the request boundary and should continue to own request-level correlation.

Recommended change:

- derive `requestId` once in the pipeline
- build execution metadata for semantic endpoints
- pass it into metric and dataset execution

For metric endpoints, the semantic execution call should eventually look roughly like:

```ts
executor.run(metricRef, query, {
  tenantId: ctx.tenantId,
  metadata: {
    requestId: ctx.request.headers['x-request-id'] ?? ...,
    queryId: ctx.request.headers['x-request-id'] ?? ...,
    endpointKey: ctx.metadata.name ?? ctx.metadata.path,
    semanticEntityType: 'metric',
    semanticEntityName: name,
  },
});
```

For dataset endpoints, the direct builder execution path should receive equivalent execution metadata.

## Semantic-Layer Changes

`MetricExecutor` and the dataset endpoint path should accept a richer execution context.

Suggested evolution:

```ts
interface ExecutionContext {
  tenantId?: string;
  metadata?: ExecutionMetadata;
}
```

Then:

- base metrics pass execution metadata to `builder.execute(...)`
- derived metrics pass execution metadata to `builderFactory.rawQuery(...)`
- dataset endpoint does the same for direct builder execution

## ClickHouse-Layer Changes

The ClickHouse layer already supports the right shape conceptually. The main work is mapping the semantic protocol onto the existing execution options.

What should happen:

- `QueryBuilder.execute({ metadata })`
  - derive `queryId` from metadata
  - forward `queryId` into adapter execution
  - include metadata in `logContext`
- `rawQuery(sql, params, { metadata })`
  - same handling

This may require:

- widening the public `rawQuery()` helper in `createQueryBuilder()`
- widening the `QueryBuilderLike` protocol in `@hypequery/datasets`
- optionally widening the adapter-side execution options if more than `queryId` is needed

## Logger Model Observations

There is currently a mismatch in logger shape:

- `ServeQueryLogger` is per API / request-facing
- ClickHouse `logger` is a global singleton

This is acceptable short term, but it is not ideal long term.

Short-term recommendation:

- keep both
- join them via `requestId` / `queryId`

Long-term recommendation:

- introduce a unified instrumentation sink or event interface
- allow both request-level and DB-level events to be emitted into one stream

This does not need to block the first tracing PR.

## Logging Safety

The ClickHouse logger currently logs rendered SQL and parameters.

This is useful, but eventually needs guardrails:

- redaction for sensitive parameters
- optional SQL fingerprinting
- log sampling
- configurable parameter logging

This is especially important before hosted/cloud rollout, but not required to begin correlation work.

## Suggested Incremental Rollout

### Phase 1: Correlation Only

Smallest useful change:

- pass `serve` `requestId` into semantic execution
- use it as `queryId` at the ClickHouse layer
- include semantic entity metadata in query logs

This is the highest-value low-risk step.

### Phase 2: Protocol Cleanup

- formalize `ExecutionMetadata`
- widen semantic query-builder protocol
- widen ClickHouse `rawQuery()` helper API

### Phase 3: Unified Instrumentation

- add a normalized observability event sink
- emit correlated request, semantic, and DB events into one stream

### Phase 4: Cloud Tracing

- map metadata onto proper trace/span concepts
- add structured export targets
- integrate with hosted observability pipeline

## Release Guidance

This work does **not** have to block the semantic endpoints release unless the release is being treated as the immediate foundation for cloud observability.

Recommended stance:

- semantic endpoint functionality can ship first
- cross-layer logging/tracing can land in a dedicated follow-up PR
- do not market current behavior as full end-to-end tracing

If cloud work is only a few PRs away, it is reasonable to prioritize the follow-up immediately after release.

## Proposed Follow-Up PR Scope

Suggested PR title:

`feat: propagate execution metadata across serve, semantic, and clickhouse`

Suggested scope:

1. Add `ExecutionMetadata` type
2. Widen semantic query-builder protocol
3. Update `MetricExecutor` to pass execution metadata through
4. Update dataset endpoint builder execution path to pass execution metadata through
5. Update ClickHouse query builder `execute()` and `rawQuery()` to accept metadata
6. Map metadata to:
   - `queryId`
   - query log context
   - ClickHouse `query_id`
7. Add tests covering:
   - request ID propagation
   - metric base execution
   - metric derived execution
   - dataset execution
   - cache execution path

## Key Decision

The semantic layer should depend on a richer execution **interface**, not on the concrete ClickHouse package.

That is the core architectural decision to preserve.
