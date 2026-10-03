# Datasets implementation guide

The canonical execution path is `createDatasetClient({ queryBuilder })`.
Keep model validation, SQL compilation and client orchestration separate so
semantic features and future dialects can evolve without growing the client.

## Where changes belong

| Responsibility | Module |
| --- | --- |
| Dataset authoring and definitions | `src/dataset.ts`, `src/measure.ts`, `src/types.ts` |
| Definition-time checks | `src/utils/dataset-definition-validation.ts` and focused measure validators |
| Dataset query contract validation | `src/utils/dataset-query-validation.ts` |
| Metric query contract validation | `src/utils/metric-query-validation.ts` |
| Shared dimension, aggregation and ordering plans | `src/query-planner.ts` |
| Base metric compilation | `src/utils/metric-query-builder.ts` |
| Derived metric CTE and outer SQL compilation | `src/utils/metric-derived-query.ts` |
| Base dataset compilation | `src/utils/build-dataset-query-builder.ts` |
| Dataset execution and result shaping | `src/dataset-query.ts` |
| Shared dataset preview and execution dispatch | `src/utils/compile-dataset-query.ts` |
| Derived dataset compilation | `src/utils/dataset-derived-query.ts` |
| Window and shift compilation | `src/utils/time-measure-*-sql.ts`, `src/utils/shift-measure-sql.ts`, `src/utils/composite-time-measure-sql.ts` |
| Metric execution and builder resolution | `src/metric-query-engine.ts` |
| Client defaults, caching, result limits and target dispatch | `src/executor.ts` |
| Result shaping and serialization | `src/utils/dataset-query-result.ts`, `src/utils/semantic-result-serialization.ts` |
| Builder acceptance and runtime contract | `src/query-builder-protocol.ts` |

Contract validators return semantic errors without obtaining a builder or
executing SQL. `MetricQueryEngine.validate()` additionally compiles a query to
catch builder capability and compilation errors. Cache hits use contract
validation without this compilation step; keep that distinction intact.

Compilation helpers receive the active builder factory explicitly. The engine
resolves it from its default and `ExecutionContext.runtime.builderFactory`.
Dataset and metric execution must use the same active factory as compilation.
Keep timezone defaults, cache state and other state-dependent behavior on their
owning classes. Put independently testable helpers in focused `utils/` modules.

`executor.ts` continues to export `MetricQueryEngine` and its options for existing
consumers. Preserve shipped exports when moving implementations, including the
`src/internal.ts` surface consumed by serve.

## Adding dialect support

The structural builder protocol is already decoupled from ClickHouse, but SQL
rendering still contains ClickHouse assumptions. Future dialect work should
start at the compilation modules above and the focused rendering helpers for
grains, timezone conversion, filtered aggregates, formulas and relationships.
Source-name and raw-SQL lexical rules belong alongside definition validation.
Window and shift compilation also needs dialect support; ordinary grain
rendering alone does not cover it.

Keep the initial ClickHouse extraction byte-identical. Land intentional changes
to quoting, week starts or other semantics separately with explicit tests.
The `PlanNode` / `SemanticBackend` execution path in `src/semantic-plan.ts` is
frozen and receives bug fixes only; new features use the query-builder path.

## Verification

Run the datasets build, unit tests, type tests and lint. Existing SQL equality
tests cover authored and rehydrated definitions. The serve integration suite
also checks compatibility with `MetricQueryEngine` through the internal export.
Changes to SQL semantics additionally need the relevant ClickHouse integration
tests. Type-level API changes need consumer type tests, and user-facing changes
need a changeset.
