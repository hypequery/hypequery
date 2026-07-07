# Analytical Measures: argMax, argMin, percentile, median, stddev, variance

Date: 2026-07-07
Status: implemented 2026-07-07 (branch `claude/analytical-measures`, off `main`).
All suites green: datasets 196 unit + type tests, clickhouse 511 unit tests,
serve/mcp typechecks. Live integration cases added (run in CI's ClickHouse
harness; not executed locally — no Docker in the authoring environment).
Sources: `packages/datasets/src` (measure, aggregations, types, planners, backends,
catalog, contract, validation), `packages/clickhouse/src` (query builder
aggregation feature, semantic backend).

## Goal

First-class support for richer analytical aggregations in the datasets DSL,
executable on all three paths (query-builder, ClickHouse semantic backend,
in-memory backend), surfaced in catalog/contract for MCP/AI consumers.

## DSL surface

```ts
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string(), amount: dimension.number(), createdAt: dimension.timestamp({ column: 'created_at' }) },
  measures: {
    p95OrderValue:  measure.percentile('amount', 0.95),
    medianValue:    measure.median('amount'),                    // sugar: percentile 0.5
    latestStatus:   measure.argMax('status', 'created_at'),      // value of status at max(created_at)
    firstStatus:    measure.argMin('status', 'created_at'),
    valueStddev:    measure.stddev('amount'),                    // sample stddev (stddevSamp)
    valueVariance:  measure.variance('amount'),                  // sample variance (varSamp)
  },
});
```

Matching `AggregationSpec` helpers are added to `aggregations.ts` for API parity
(`percentile(field, level)`, `median(field)`, `argMax(field, by)`, `argMin`,
`stddev`, `variance`).

## Type/plan model

- `AggregationType` union gains `'argMax' | 'argMin' | 'percentile' | 'stddev' | 'variance'`.
  `median` is **normalized at helper level** to `percentile` with `level: 0.5` —
  no new plan type.
- `MeasureDefinition` / `AggregationSpec` / `SemanticAggregationPlan` gain
  optional `argField?: string` (argMax/argMin second column) and
  `level?: number` (percentile). Optional fields keep existing contract
  serialization stable for datasets that don't use them.
- `argField` resolves through the dimensions map exactly like `field`
  (column override honored) on both planner paths.

## Execution semantics

| Aggregation | ClickHouse SQL | In-memory |
|---|---|---|
| percentile | `quantile(level)(field)` (approximate, CH default) | sorted values, linear interpolation |
| argMax / argMin | `argMax(field, argField)` / `argMin(...)` | scan tracking extreme argField, return field value; empty → null |
| stddev | `stddevSamp(field)` | sample stddev; n<2 → 0 |
| variance | `varSamp(field)` | sample variance; n<2 → 0 |

Notes:
- `quantile` (approximate) is the deliberate default; exact variants remain
  available via the `sql:` escape hatch on measures.
- In-memory percentile is linear interpolation — approximate parity with
  ClickHouse's sampling-based `quantile`, exact only for small/clean inputs.
  Tests use values where both agree.
- In-memory `aggregateRows` return type widens `number → unknown` (argMax over
  a string field returns a string).

## Rules and restrictions (v1)

1. **Measure `filters` are rejected on argMax/argMin.** The `if(cond, field, NULL)`
   wrapper the other aggregations use has version-dependent NULL semantics under
   `argMax` in ClickHouse. percentile/stddev/variance support filters via the
   existing NULL-fallback wrapper (CH aggregate functions skip NULLs).
2. **Percentile level** must be a finite number in `[0, 1]` — validated at
   helper creation and again at planning time (level is interpolated into SQL,
   so it is also an injection guard).
3. **Metrics** (`Orders.metric(...)`, contract `valueType: 'number'`):
   - percentile/stddev/variance metrics require a numeric dimension when the
     field is declared (same rule as sum/avg in `validateBaseMetric`).
   - argMax/argMin metrics are allowed only when the target field is *not* a
     declared non-numeric dimension (a declared string dimension would violate
     the numeric contract; undeclared/hidden fields are trusted as today).
4. **Row typing**: static measure row values remain `number`. For argMax/argMin
   over non-numeric fields the runtime value follows the field's type — a
   documented v1 limitation (per-measure value types would require making
   `MeasureDefinition` generic; deferred).

## Query-builder protocol + ClickHouse builder

`QueryBuilderLike` gains five required methods (pre-release; the only known
implementor is `@hypequery/clickhouse`):

```ts
argMax(column: string, argColumn: string, alias?: string): QueryBuilderLike;
argMin(column: string, argColumn: string, alias?: string): QueryBuilderLike;
quantile(column: string, level: number, alias?: string): QueryBuilderLike;
stddev(column: string, alias?: string): QueryBuilderLike;   // stddevSamp
variance(column: string, alias?: string): QueryBuilderLike; // varSamp
```

The ClickHouse `QueryBuilder` implements them in `AggregationFeature`,
marking selections `isAggregate: true` — required because GROUP BY inference
recognizes aggregates by a `COUNT|SUM|AVG|MIN|MAX` prefix regex that none of
these match. These are also generally useful public builder API.

Datasets stays semantically neutral (it says "quantile of column at level");
each builder renders its own dialect.

## Catalog / contract / MCP

- `MeasureCatalogEntry` and `ContractMeasure` gain optional `argField` /
  `level` (conditional spread — absent for existing measures, so existing
  contract hashes are unchanged).
- Serve endpoints enumerate measure *names* only — no serve changes needed.
  MCP `get_dataset_schema` flows the new catalog fields automatically.

## Out of scope / deferred

- Schema-compat checks for `argField` column existence and numeric-type checks
  for percentile/stddev/variance (`packages/schema` is frozen per the 2026
  roadmap; the existing aggregation-agnostic `field` column check still applies).
- Exact quantile variants, weighted quantiles, multi-level `quantiles(...)`.
- Per-measure static value typing for argMax/argMin.
- Window-function measures (cumulative etc.) — separate "advanced metric types"
  work item (launch plan 2.2).

## Touch list

`packages/datasets/src`: types.ts, measure.ts, aggregations.ts, index.ts,
utils/dataset-normalization.ts, utils/dataset-validation.ts,
utils/filtered-aggregation-sql.ts, query-planner.ts, query-builder-protocol.ts,
semantic-plan.ts, semantic-planner.ts, in-memory-backend.ts, catalog.ts,
contract.ts, api.type-test.ts (mock), datasets.test.ts (mock) + new test file.

`packages/clickhouse/src`: core/features/aggregations.ts, core/query-builder.ts,
datasets.ts, core/tests/datasets-backend.test.ts + builder aggregation tests,
`packages/datasets/src/tests/integration/clickhouse-backend.test.ts` (live cases).

## Test plan

- Helper validation (level range, argMax signature).
- Metric validation (numeric rules, argMax-over-string rejection).
- Filtered-measure rules (argMax rejection; percentile NULL wrapper).
- In-memory execution correctness for all five aggregations (grouped + global).
- Builder-path SQL via mock builder.
- ClickHouse builder SQL generation (`argMax(status, created_at) AS x`,
  `quantile(0.95)(amount) AS p95`, GROUP BY not polluted).
- ClickHouse backend plan translation (mock adapter).
- Live integration cases computed from the seeded orders table.
