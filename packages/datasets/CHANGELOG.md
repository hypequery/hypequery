# @hypequery/datasets

## 0.28.0

### Minor Changes

- 4847c9c: Add `buildClientContract(deployment, options)`, which turns a deployment contract (for example `publishToCloud`'s output) into a hashed client contract that `hypequery generate:client` reads. It follows the Python builder's rules: unknown nullability for local fields, tenant-key filters never advertised, operators narrowed by field type, portable time grains, and limits narrowed by each dataset. Relationship fields are not exported yet. Hosts pass their own routes, query ceilings and default timezone; `view: 'authorized'` with `include` marks a caller's view; `include` filters whole datasets only, so field-level narrowing stays with the host. Only datasets with an endpoint are exported, and a dataset with a field named `period` alongside a time field is rejected.

### Patch Changes

- 17ffe2b: Strict client-query rejections say where they failed. `validateProtocolClientQuery`
  now sets a JSON Pointer on every `HQ_CLIENT_QUERY` error (`/filters/0/value`,
  `/orderBy/1/field`, `/grain` for agents) instead of the root for most of them.
  Pointers name contract members and item indexes only; an unknown member is still
  reported at the root because its name is submitted data. The shared conformance
  fixtures pin the pointers for TypeScript and Python.

  The typed endpoint schemas from `buildClientContractQuerySchemas` carry the pointer
  as the zod issue path, and the MCP HTTP bridge names it in its error message
  (`Invalid client query at /filters/0/value.`).

- 2b5ff4e: Three planner fixes that change results:

  - Base dataset columns are always qualified with the dataset source, not only
    when a relationship join is present. ClickHouse resolves an output alias
    before a column of the same name, so a dimension `status` reading column
    `country` captured a filter or selection on the real `status` column (silent
    wrong rows), and a measure named like its column (`amount: measure.sum('amount')`)
    broke any other measure or filter on that column with `ILLEGAL_AGGREGATION`.
  - Under a runtime scope of several tenants (`{ in: [...] }`) or all tenants
    (`{ scope: 'all' }`), relationship joins also match the tenant keys, so a key
    reused by another tenant no longer joins that tenant's row. `checkRelationships`
    counts (key, tenant) pairs under those scopes to match. Single-tenant SQL is
    unchanged.
  - Formula `divide` casts the dividend to Float64. Decimal division kept the
    dividend's scale and truncated, so `round(divide(revenue, nullIfZero(orders)), 2)`
    could come out one cent low and a Decimal share such as 0.685 read 0.68.

- Updated dependencies [17ffe2b]
  - @hypequery/protocol@0.24.2

## 0.27.0

### Minor Changes

- f103760: Add `isNull` and `isNotNull` comparisons, which take no value (RFC 0023), so
  "has a churn date" is `churned_at IS NOT NULL` rather than a sentinel range. A
  protocol comparison using one is `{ kind: 'comparison', operator: 'isNotNull',
left }` with no `right`; a client query filter is `{ field, operator: 'isNull' }`
  with no `value`. Validators reject a value on them and accept any field type.
  Measure fixed filters and segments can use them directly, including through the
  new `isNull(field)` and `isNotNull(field)` helpers (also re-exported by
  `@hypequery/serve`). Caller query filters are opt-in: a filter allows them only
  when its `operators` list names them, so default operator lists, and the
  identity of every existing deployment and client contract, are unchanged. The
  deployment data plane, the MCP dataset guide and the generated client input
  types support them, and the conformance corpus pins the new cases. Upgrade
  every consumer before publishing a contract that uses them: earlier validators
  reject the new operators.

### Patch Changes

- Updated dependencies [24f82d5]
- Updated dependencies [f103760]
  - @hypequery/protocol@0.24.0

## 0.26.0

### Minor Changes

- 5c6c96c: Publish `measure.merge` measures to the deployment contract (RFC 0022). A base
  measure may use `aggregation: 'merge'` with a `stateFunction` from the shared
  allowlist (now exported by `@hypequery/protocol`); it takes no filters or `sql`,
  and in contract 3 carries `approximate: true` exactly for estimating states.
  Deployments rehydrate merge measures, so hosted runtimes can serve
  pre-aggregated tables. A metric over a merge measure is still refused, because
  the expression grammar has no merge aggregate.

### Patch Changes

- Updated dependencies [5c6c96c]
  - @hypequery/protocol@0.23.0

## 0.25.0

### Minor Changes

- 3492dc9: Add enforced constraints to `createDatasetClient`: `context.runtime.constraints` takes RFC 0019 comparisons (a declared filter or a one-hop `relationship.field`) resolved from trusted context. They are ANDed onto every read of the dataset's source, in every query shape: aggregate, derived, `having`, window, shift, metrics, derived metrics and relationship joins. A constraint the dataset can't enforce refuses the call without describing the constraint. Constraints share the dataset's `maxFilters` ceiling with the caller (at most 32 per call), enter the result-cache key, and are refused on the deprecated semantic-backend path rather than dropped. The runtime tenant and constraints are now applied at a single source-scoping step (RFC 0020). Queries without constraints generate identical SQL and keep their cache keys.
- 18257df: Datasets can declare more than one time axis. `timeKey` stays the default; list the others in `timeKeys`, then select one per query with `timeKey`, on dataset and metric queries alike:

  ```ts
  const Orders = dataset("orders", {
    source: "orders",
    timeKey: "createdAt",
    timeKeys: ["shippedAt"],
    dimensions: {
      /* ... */
    },
    measures: { revenue: measure.sum("amount") },
  });

  await client.execute(Orders, {
    measures: ["revenue"],
    by: "month",
    timeKey: "shippedAt",
  });
  ```

  Typed queries narrow `timeKey` to the dataset's declared axes, so a misspelled axis is a compile error (exported as `DatasetTimeKeyNames`). The selected axis drives grains, window and shift measures, and their bounded-range checks. Timezone-free filters on any declared axis use the query timezone. The result cache keys an alternate axis separately; queries on the default axis keep their existing keys. Catalogs and contracts publish `timeKeys` only when a dataset declares alternates. `buildDatasetInputSchema` / `buildMetricInputSchema` take a new opt-in `timeKey` option, which Serve endpoints and `generateDatasetTools` enable, so other schemas and manifest hashes are unchanged. The deprecated `backend` path rejects alternate axes.

- ffc2610: Add `rowResolution` (RFC 0021), the one API for reading versioned ClickHouse
  sources, in code and in the deployment contract, so they can be published.
  `{ kind: 'final' }` reads the source with `FINAL`; naming the engine
  (`replacing` with `deletedColumn`, `collapsing`/`versioned-collapsing` with
  `signColumn`) also keeps only current rows, on base reads and relationship targets.
  Deployment contracts preserve the policy on validation, hashing and rehydration,
  so a published dataset reads exactly as it does locally.

  `final: true` is deprecated: it still works, is read as `rowResolution:
{ kind: 'final' }`, and logs a one-time warning. Its result-cache keys change once,
  because they are now built from `rowResolution`.

### Patch Changes

- db271b2: Fix to-date measures returning `null` on every row in a non-UTC query timezone when they are reached through a nested derived measure (the composite time-measure plan). The to-date start is now kept in the query timezone instead of the server's.
- Updated dependencies [ffc2610]
  - @hypequery/protocol@0.22.0

## 0.24.0

### Minor Changes

- 9d97163: Add semantic client contract v1 validation, canonical identities and strict HTTP/MCP query validation. Compile typed endpoint/tool schemas from public descriptors and test Python/TypeScript with the required shared conformance family. Existing catalog schemas keep their defaults.
- 4af1695: Add `measure.merge(stateFunction, field)` (and `merge()` for metric configs) to read `AggregateFunction` columns of AggregatingMergeTree tables with the matching `-Merge` combinator, for example `measure.merge('uniq', 'users')` renders `uniqMerge(users)`. Trailing and to-date windows merge states across buckets, so weekly distinct counts from daily states are exact to the state function. State functions are allowlisted; merges of estimating states are catalogued as `approximate`. Merge measures are refused with measure filters, raw `sql`, relationships, cumulative windows, semantic backends and deployment-contract publishing. `@hypequery/clickhouse` adds `mergeState(stateFunction, column, alias)` to the query builder; `QueryBuilderLike` gains it as an optional member.
- c1f1dd8: Add `final: true` to dataset definitions for ReplacingMergeTree and CollapsingMergeTree sources. Every query on the dataset, every join that targets it and `checkRelationships` read the source with ClickHouse `FINAL`, so unmerged row versions are no longer counted and soft-deleted keys (`ReplacingMergeTree(ver, is_deleted)`) disappear. Builders gain an optional `final()` protocol method; a final dataset is refused with a clear error on builders without it, on semantic backends, and when publishing to the deployment contract, which cannot carry the flag yet. Datasets without `final` generate identical SQL and keep their cache keys.
- afa5e81: Zod-backed schema builders and agent tools now have their own entry, `@hypequery/datasets/schemas`: `generateDatasetTools`, `toOpenAITools`, `toAISDKTools`, `toMcpTools`, `buildDatasetInputSchema`, `buildMetricInputSchema`, `buildCanonicalSemanticQuerySchemas`, `toSemanticJsonSchema`, `buildDatasetInputProtocolSchema`, `buildMetricInputProtocolSchema`, `zodToProtocolSchema`, `ProtocolSchemaAdapterError` and `buildClientContractQuerySchemas`. Their root-entry re-exports still work and are marked `@deprecated`; 1.0 removes them, and Zod becomes an optional peer dependency needed only by `/schemas`.

  Datasets now depends on `zod@^4.6.6` (was `^3.22.4`), which clears GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized arrays). Zod was only used to build datasets' own schemas, so this needs no change from you. The generated JSON Schemas and `manifestHash` are unchanged. Two visible differences: validation messages for an unknown field now list the valid options (`Invalid option: expected one of …` instead of `Invalid enum value`), and `zodToProtocolSchema` accepts schemas from Zod 3 or Zod 4.

- 68b0aa8: Add `assertDeployable(dataset)`, which refuses derived measures the deployment contract cannot carry (a reference to another derived measure, or a literal anywhere other than `round` decimals or a `coalesce` fallback) with an error naming the dataset and measure, for example `orders.doubled: a numeric literal cannot be an arithmetic operand in a deployable formula`. `buildProtocolDeploymentContract`, and so `hypequery deploy`, runs the check before building the contract instead of failing later with only a contract path such as `$.datasets[2].measures[19].expression.right`.

### Patch Changes

- bc14e60: Add `toSQLWithPlaceholders(placeholder)` to the query builder: it compiles the query and writes each bound value through the callback, in SQL order, so a caller can number placeholders when embedding the statement in a larger one. `@hypequery/datasets` adds it as an optional `QueryBuilderLike` member, used only by datasets dialects that number placeholders. ClickHouse datasets queries keep using `toSQLWithParams`, so existing builders and generated SQL are unchanged.
- aa10003: Exclude internal runtime and type-test programs from published package tarballs while preserving public runtime and declaration exports.
- 91804f0: Fix the `dataset()` JSDoc example so the `belongsTo` join names the physical `customer_id` column rather than the `customerId` dimension; relationship `from`/`to` keys are columns, and the dimension name fails at query time.
- 3661a84: Bind time-measure (window and shift) axis bounds as query parameters instead of writing them into the SQL text. `compileDataset()` and `toSQL()` now show `parseDateTime64BestEffort(?, …)` with the caller's bounds in `parameters` (and in each preflight statement's parameters). The statement ClickHouse executes is unchanged.
- 87ed4ad: Route every ClickHouse-specific SQL spelling in the datasets planner (time grains and arithmetic, timezone conversion, time-measure guards and series expansion, window aggregates, measure-filter literals, formula rendering and row packing) through the internal datasets SQL dialect. Generated ClickHouse SQL is unchanged. A custom `datasetSqlDialect.quoteIdentifier` hook now also applies to time-measure (window and shift) queries.

  `GRAIN_FUNCTIONS` is deprecated: grain SQL is engine-specific and no longer read by the planner. Use `SUPPORTED_TIME_GRAINS` to enumerate grains.

- 8201f86: Render derived metric formulas through the datasets SQL dialect, the same renderer derived measures use, instead of `FormulaExpr.toSQL()`. Generated SQL changes only in parenthesization (`(a) / (NULLIF(b, 0))` becomes `(a / NULLIF(b, 0))`); results are unchanged. A derived metric formula that references an input not declared in `uses` is now rejected rather than written into the SQL. `FormulaExpr.toSQL()` itself is unchanged.
- 9f19fc3: Quote every alias the datasets planner generates — dimension, `period`, measure and metric aliases, and the GROUP BY, ORDER BY and outer-query references to them — so names that are SQL keywords (`rows`, `order`, `end`, `window`, …) work and engines that fold unquoted case keep the semantic name. `compileDataset()` and `toSQL()` show the backtick-quoted aliases; result row keys are unchanged. Custom `QueryBuilderLike` implementations receive these aliases already quoted and must insert them verbatim.
- fcf39bb: Preserve NULLs for unmatched related dimensions and related-dimension filters independently of ClickHouse `join_use_nulls`, including queries that select no related measure. Every relationship join now projects the target with a `_hq_match` marker, and a joined dimension such as `customer.tier` renders as `if(isNotNull(customer._hq_match), customer.tier, NULL)` in SELECT, GROUP BY, ORDER BY, WHERE and measure filters. An order whose customer is missing or belongs to another tenant groups under `NULL` instead of `''`/`0`, and a `neq` filter on a joined dimension excludes it, matching the Python package and standard SQL semantics.
- 2a9ac25: Accept ISO 8601 instants in timestamp filters. A value carrying `Z` or an offset, such as `new Date().toISOString()` produces (`2026-02-01T00:00:00Z`, `2026-02-01T00:00:00.000Z`), previously failed in ClickHouse with "Cannot convert string ... to type DateTime64". The datasets planner now rewrites such a value to its wall clock in the zone the column is compared in, so it selects the same rows as the equivalent offset-free form and matches the Python planner. Offset-free values (`2026-02-01T00:00:00`, `2026-02-01 00:00:00`, `2026-02-01`) are bound unchanged and still read as local time in the query timezone.
- c413f61: Two parity fixes with the Python SDK:

  - A dimension declared `groupable: false` is now refused as a query dimension, locally and through a relationship (`Dimension "x" is not groupable.`). It can still be filtered on. Serve's input schemas already excluded these dimensions; direct client queries didn't.
  - `buildProtocolDeploymentContract` lists datasets by name, so the deployment contract and its identity no longer depend on the order the datasets are passed in. A deployment whose datasets weren't already in name order gets a new, stable identity once.
  - Protocol artifacts now order names with a fixed collation (underscore, digits, then letters without case, lowercase first) instead of the host's `localeCompare`, matching Python's `portable_name_key`. Contracts and their identities no longer change with the machine's locale; under the default locale the order is unchanged.

- cbf8691: MCP tools refuse a `limit` above the endpoint's `maxLimit` with `MCP_INVALID_ARGUMENTS` instead of silently clamping it, so an agent never mistakes a shortened page for the whole answer. Tool schemas built from a client contract advertise that ceiling as the `limit` maximum, and `validateProtocolClientQuery(..., 'mcp')` enforces it. HTTP requests keep clamping, as both Serve implementations do.
- e32fa97: Upgrade `@noble/hashes` to v2. Hash outputs are unchanged.
- dbee699: Refuse number filter values that aren't safe integers (beyond ±2^53). Number filters bind as Float64, so such a value is already rounded and silently matched nothing against an exact `Int64` or `UInt64` id. Declare a large id as `dimension.string()` to filter it exactly.
- bb910a4: Dataset and metric endpoints now enforce the related dataset's own policy. Previously a query on one served dataset could read fields of a related dataset through a relationship, such as `shipment.carrier` on `orders`, even when the caller failed that dataset's own endpoint's `requiredRoles`, `requiredScopes` or auth requirement. Such a query now answers `403 FORBIDDEN` before it is planned. The check covers measures whose fixed filters read a related field, directly or through a derived measure, including the measures an omitted `measures` list selects. A related dataset with no local auth setting inherits the API's global auth, as its own endpoint does, and policies are matched to the related dataset definition itself rather than to any dataset sharing its name. Related datasets that are not served as their own entry are unaffected, so existing APIs keep working unless they relied on reading a protected dataset through another one.
- 636b46f: Refuse timestamp filter values that are not a real ISO 8601 date or date-time, such as `2026-13-45`, `2026-02-30`, `yesterday`, `20260201` or `2026-01-31 12:00`. `validate()` reports them and execution fails before planning. ClickHouse read some of these as a different instant instead of failing: `2026-13-45` became 1900-01-01 and `2026-02-30` rolled into March, so queries silently returned wrong totals. Accepted forms are `YYYY-MM-DD`, or `YYYY-MM-DD[T ]hh:mm:ss[.fraction]` optionally followed by `Z` or `±hh:mm`, which includes `Date#toISOString()` output. `like` patterns on timestamp fields are unchanged.
- Updated dependencies [9d97163]
- Updated dependencies [e0f9c6e]
- Updated dependencies [cbf8691]
- Updated dependencies [e32fa97]
  - @hypequery/protocol@0.21.0

## 0.23.1

### Patch Changes

- Updated dependencies [d1e4194]
  - @hypequery/protocol@0.20.0

## 0.23.0

### Minor Changes

- 489a658: Support composite equality keys in dataset relationships using a non-empty keys array while preserving existing from/to definitions. Compile all pairs as a single-match AND join through the key-pair form of `leftAnyJoin` (`@hypequery/clickhouse` >= 2.13.0), preserve tenant scoping and related-measure inputs, and check uniqueness of full non-NULL target tuples. Retain all key pairs in catalogs and portable contract round-trips. Declare `@hypequery/clickhouse` >= 2.13.0 as an optional peer dependency of datasets. Existing `{ from, to }` relationships are unchanged and are not subject to the composite identifier rules. Portable contracts only carry `keys` for two or more pairs, and `keys[0]` must match `from`/`to`.
- 064661f: Dataset queries accept `having` conditions on aggregated measure values (HQ-329):

  ```ts
  await analytics.execute(Orders, {
    dimensions: ["customerId"],
    measures: ["revenue"],
    having: [{ measure: "revenue", operator: "gt", value: 10_000 }],
  });
  ```

  Each condition must reference a selected measure, including derived measures.
  Operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in` and `notIn`.
  Values are finite numbers bound as parameters. Conditions are applied after
  grouping and before ordering and limits. Queries with `having` bypass the result
  cache until the shared cache-key preimage covers conditions, as in the Python SDK.
  A dataset's `limits.maxFilters` bounds filters and having conditions together.
  Queries that select window or shift measures, and the deprecated semantic backend
  path, reject `having`. Generated input schemas accept `having` only when built
  with `{ having: true }`, so existing schemas and manifest hashes are unchanged.

- 0d88c0e: Catalogs and semantic contracts now include each derived measure's inputs (`uses`) and expression, so changing a formula changes the snapshot hash. **Datasets that already declare derived measures report a new semantic contract `contentHash` after upgrading**, including the one Serve's contract endpoint publishes; consumers that compare it to detect definition changes will see one change. Definitions without derived measures are unchanged, as are result-cache keys and deployment contracts. Shared fixtures now pin Python derived-measure authoring to the same deployment and semantic contract output.

### Patch Changes

- aada8f3: `dataset()` now validates filter definitions before any query can use them.
  A measure filter's `field` must be a declared dimension or filter, or a safe
  column identifier (optionally `<relationship>.<field>`), and a declared filter's
  `field` must be a declared dimension or a safe column identifier. Unsupported
  operators are rejected in both places. Previously these values were rendered
  into SQL unchecked. Definitions that put SQL text in a filter `field` now fail at
  construction: declare a dimension with `sql` and filter on that dimension.
- 03ba7f2: Fix calendar shifts (`month`, `quarter`, `year`) on a partial `week` bucket.
  When a query filter cut a week short, its lower bound was shifted on its own
  while its upper bound stayed anchored to the shifted week. A week starting
  mid-way could get an empty range and read `null` even when the prior period had
  rows, and a week cut on both sides could count rows from days it never covered.
  Both bounds are now placed inside the shifted week: a whole week still maps to
  its start minus the interval plus seven days, and a partial week maps to the
  matching slice. Shifted formulas (derived, windowed and cumulative measures
  under a shift) are fixed the same way.
- Updated dependencies [489a658]
  - @hypequery/protocol@0.19.0

## 0.22.0

### Minor Changes

- 0841d1c: Add `compileDataset` to preview the same dataset compilation path used by
  execution, including effective row limits, pagination overfetch, measure
  dependencies and time-axis preflight statements. Structural diagnostics and JSON
  serialization omit SQL, parameter values and tenant identifiers.

  Add `createPortableSemanticRuntime` for provider-side compilation and execution
  over the same activated catalog, and expose a tested capability matrix that
  separates protocol representation from TS, Python and Cloud implementation
  support. Existing logical SQL and portable executor APIs remain available.

- 9b5b523: Support one-hop relationship base measures in dataset queries through the query-builder client. Allow duplicate-insensitive aggregates through belongsTo and all base aggregates through declared hasOne relationships, preserve tenant and fixed-filter scoping, and exclude unmatched target rows from aggregate inputs. Advertise safe names and approximate metadata in runtime catalogs and input schemas, with typed projections through Serve and React.
- f30add1: Preserve dataset filter allowlist names and field-specific operators through dataset and metric queries, Serve API inputs, and React hooks. Generated filters respect `filterable: false`, and one-hop relationship filters follow the target allowlist. Filter helpers retain operator literals.

  Prevent normal dataset execution from falling through to the legacy dynamic-query overload; explicit result-row generic calls remain supported. Fix Serve in-process execution input inference so its optional schema storage property no longer widens typed inputs to unknown.

### Patch Changes

- 339deef: Snapshot dataset and metric query inputs and tenant runtime before cache lookup,
  so caller mutations during an asynchronous store read cannot cache another
  tenant's result under the original tenant's key.
- 1effbb2: Add an optional datasets SQL rendering hook to query builder factories, with a
  ClickHouse default that preserves existing SQL. Resolve the hook from runtime
  builder overrides and route existing quoted identifiers through it as the
  foundation for subsequent dialect extraction.
- 339deef: Reject unsupported semantic filter operators and invalid sort directions at
  runtime, including direct SDK inputs, before compilation or cached execution.
  Render sort directions through a closed mapping instead of interpolating input.

## 0.21.0

### Minor Changes

- 7c009de: Support calendar month, quarter, and year shifts at finer query grains. Clamp
  missing dates to the target month's last day, preserve full bucket widths and
  partial local endpoints, and exclude unmapped source buckets from dimension
  populations. Catalog grain metadata uses the same validation rules.
  Calendar shifts at minute and hour grains reject nonexistent local times in the
  target period instead of silently reusing an adjacent bucket.
- 97ee149: Allow period comparisons to wrap windows, formulas, and other comparisons, with recursive formula dependencies and inherited catalog grain requirements.

### Patch Changes

- 40ac480: Refresh production dependencies. Keep the ClickHouse adapter compatible with the client packages' bundled setting types.
- Updated dependencies [a8e502e]
  - @hypequery/protocol@0.18.0

## 0.20.0

### Minor Changes

- f9205cb: Add `measure.shift` for period comparisons through the query-builder client. Shifted measures share window time-axis validation, gap filling, filters, tenant scope, and derived formulas. Catalogs and agent projections expose their intervals and time-range requirements.

  Reject shifted source ranges that cross a skipped local calendar bucket, including empty populations, rather than duplicating comparison values.

  Comparisons match partial query ranges and preserve endpoint operators. Catalogs and agent projections expose compatible grains for time measures and their formulas.

- 0846e87: The result cache now stores entries under opaque RFC 0009 / RFC 0013 keys instead of readable query signatures. Tenant ids, filter values, and table names no longer appear in store keys, and keys match the Python SDK's for the same release, query, and tenant.

  New optional `cache` options:

  - `secret`: the RFC 0013 key secret. When omitted, a random secret is generated per client.
  - `project` and `environment`: the key namespace.
  - `keyVersion`: increment when rotating the secret.
  - `definitionIdentity`: the deployed bundle identity, to share entries across runtimes.

  An empty or short secret, or an invalid namespace, now throws when the client is created.

  Migration:

  - **Default in-memory cache:** no action needed.
  - **Shared stores (e.g. Redis):**
    - Existing entries become unreachable after upgrading, so the cache starts cold once and old entries expire by TTL.
    - Set `cache.secret` to the same 32+ random bytes on every instance to share entries across instances. Without it, each client keeps its own entries and logs a one-time warning.
  - **Tenant-less datasets queried under a runtime tenant:** entries are now partitioned by that tenant, which is stricter than before.
  - **Tools that read or pattern-match store keys:** keys are now opaque `hq1.…` strings. Use `clearCache()` or a store-level flush instead of key patterns.
  - `buildDatasetQuerySignature` and `buildMetricQuerySignature` remain exported, but are deprecated and no longer used for keys.

- e3ef451: Add typed authoring definitions for trailing, to-date, and cumulative dataset measures. Validate base-measure references and cumulative aggregation support, and reject execution and Cloud publishing until RFC 0015 window planning is implemented.

  Exclude window-dependent derived measures from executable catalogs and query schemas until window planning is available.

  Keep base, derived, and window definitions together in the returned dataset's `measures` registry. Retain `derivedMeasures` as a deprecated compatibility alias, while default queries and standalone metrics continue to use only base measures.

- 6e883b5: Execute trailing, to-date, and cumulative dataset measures through the query-builder client, including sparse-series filling, lookback filters, and derived formulas. Expose window parameters and time-range requirements in catalogs and agent projections. MCP dataset guides list these measures with their time-axis requirements.

  Reject ranges that cross a skipped local calendar bucket, including window lookback, instead of generating duplicate buckets and incorrect totals.

- b3a2966: Add an execution `timezone` to dataset and metric queries, with a client default
  and UTC as the fallback. Buckets, local time-key filters, windows, and period
  comparisons use the selected IANA timezone. Cache entries are separated by
  execution timezone, and Serve and MCP accept query overrides.

  Remove the metadata-only `timezone` field from semantic definitions. Set it on
  `createDatasetClient` or the query instead.

### Patch Changes

- Updated dependencies [cc877bc]
  - @hypequery/protocol@0.17.0

## 0.19.0

### Minor Changes

- 091b8a6: Add `approxCountDistinct` (RFC 0015, HQ-77):
  - `measure.approxCountDistinct(field)` and the `approxCountDistinct` aggregation helper estimate distinct counts with ClickHouse `uniq`, including with measure filters.
  - The ClickHouse query builder gains `.approxCountDistinct(column, alias?)`.
  - Catalogs, the semantic contract, and the agent-safe catalog mark approximate measures, and derived measures that use them, with `approximate: true`.
  - The in-memory backend computes the count exactly.
  - Publishing to Cloud refuses approximate measures with an actionable error until deployment contract 3 is emitted.
- 1740f23: Add dataset segments (RFC 0015, HQ-77). `dataset(..., { segments })` declares named row filters, each an AND of comparisons over the dataset's own dimensions, and queries select them with `segments: [...]`.
  - Segments may use dimensions that callers cannot filter on. They cannot traverse relationships or constrain the tenant column, and they are validated when the dataset is defined.
  - They apply on every execution path, and the result cache key includes their resolved definitions.
  - Catalogs, the semantic contract, and the agent-safe catalog list segment names, labels, and descriptions, never their conditions.
  - Publishing refuses datasets with segments until deployment contract 3 is emitted.
- c48b1b0: Add `minute` and `hour` time grains (RFC 0015, HQ-77). They bucket with `toStartOfMinute`/`toStartOfHour` and appear in catalogs, semantic query schemas, and the local MCP tools.

  A new `timeGrains` dataset option restricts the grains a dataset supports, for example to refuse sub-day buckets on a `Date` time key. Queries, `.by()`, and the catalog honor it.

  Publishing to Cloud still emits deployment contract 2:

  - it refuses a sub-day `defaults.timeGrain` or pinned metric grain with an actionable error;
  - it refuses dataset-level `timeGrains` restrictions it cannot preserve;
  - published metric grain lists and rehydrated datasets stay at `day` through `year`.

- 9bd5e10: Portable execution now names why it excluded a surface. `UnsupportedContractFeatureError` and `PortableExecutionUnsupportedError` carry a `reason` from the new `UNSUPPORTED_CONTRACT_REASONS` export (for example `HQ_PORTABLE_AMBIGUOUS_MEASURE_SQL` or `HQ_PORTABLE_DERIVED_METRIC_WITHOUT_FORMULA`), alongside the unchanged `HQ_SEMANTIC_UNSUPPORTED_CAPABILITY` code. Existing constructors remain valid.
- 9239794: Relationship joins no longer fall back silently. A query builder without `leftAnyJoin` now rejects relationship-qualified queries with a clear error instead of downgrading to a fan-out `leftJoin`. The in-memory backend refuses duplicate to-one target keys and never matches `NULL` keys. The new `checkRelationships(dataset, { queryBuilder })` reports `belongsTo`/`hasOne` targets whose join key is not unique.

### Patch Changes

- b085b08: Expose dataset segments on every query surface. Semantic input schemas, and therefore OpenAPI and the MCP tools, accept `segments` as an enum of the dataset's declared names. Serve dataset and metric endpoints, and the MCP `query_dataset`/`query_metric` tools, forward them to the query. Typed dataset and metric inputs infer declared segment names, including through Serve and React; MCP argument types can opt into a dataset-specific type. Datasets without segments keep their existing schemas.
- Updated dependencies [74f4843]
- Updated dependencies [5d798f4]
- Updated dependencies [1ddd78b]
- Updated dependencies [2ddef5b]
  - @hypequery/protocol@0.16.0

## 0.18.0

### Minor Changes

- cf9e556: Add `publishToCloud({ datasets, access })` to declare a validated, dataset-only Cloud
  deployment without a Serve API. Dataset init now creates `analytics/cloud.ts`.
  Named metrics are rejected until Cloud supports their publication explicitly.
  An authenticated access policy is required, with optional per-dataset overrides,
  so a migration cannot silently discard Serve role and scope requirements.

  The CLI `deploy` and `deployment:build` commands now consume that explicit
  Cloud publication. They no longer compile a Serve API module or bundle Serve
  runtime handlers. The unused Serve-to-Cloud contract compiler and its
  compatibility diagnostics are removed. Local Serve and MCP development remain.
  Existing prebuilt bundles can still be verified and submitted with
  `deployment:validate` and `deployment:submit`.

### Patch Changes

- bcedb68: `compilePortableSqlExpression` now reports every non-portable input as an issue instead of throwing `ProtocolExpressionError`. The inputs that previously threw were LIKE patterns that aren't string literals, arithmetic chains deeper than 16 levels, AND/OR chains with more than 100 operands, IN lists of negative numbers past the node limit, and string literals with control characters or unpaired surrogates.
- 343377b: An "Unexpected character" issue for an emoji or other astral character now names the whole character and spans both of its UTF-16 code units. Previously it quoted half a surrogate pair.
- Updated dependencies [827d32c]
- Updated dependencies [8dcaf88]
- Updated dependencies [9c5275b]
- Updated dependencies [384b808]
- Updated dependencies [83d601f]
- Updated dependencies [39ef77a]
  - @hypequery/protocol@0.15.0

## 0.17.1

### Patch Changes

- 7b5ccd7: Enforce the joined dataset's filter exposure and allowed operators for relationship-qualified filters, including generated query schemas.

## 0.17.0

### Minor Changes

- 18a59de: Allow dataset queries to select dataset-owned derived measures alongside base measures. Derived values are computed after aggregation and before ordering and pagination, and are included in local dataset catalogs and query schemas.
- f4b30e1: Serve datasets from the deployment contract. The semantic data plane, operation validation, authorization projection, and portable executor all consume this contract. Standalone metric targets are not deployed. `AuthorizedDeploymentProjection.advertised` is removed; `queryable` now determines whether a dataset appears in the catalog.
- 623136a: Build and rehydrate deployment contracts, including derived measures. Local dataset adapters and metrics remain available. Use one shared SQL-expression validator for dataset fields and query implementations.
- ec62f1d: Add dataset-owned derived measure definitions alongside base measures in the
  `measures` authoring object, with definition-time validation while preserving
  standalone metric APIs.

### Patch Changes

- Updated dependencies [3eeebb2]
- Updated dependencies [623136a]
  - @hypequery/protocol@0.14.0

## 0.16.0

### Minor Changes

- 8bfd22f: Emit semantic input schemas as `ProtocolSchema`, so a hosted registry stops
  rebuilding them.

  `buildDatasetInputProtocolSchema` and `buildMetricInputProtocolSchema` return
  the same shape `buildDatasetInputSchema` and `buildMetricInputSchema` already
  produce, in the protocol's own schema format.

  A hosted gateway advertises one endpoint per dataset and per metric, in
  `ProtocolSchema`. Without this it has to rebuild that shape by hand — which is a
  second generator of the knowledge `CORE-03` exists to keep in one place, and it
  drifts silently rather than loudly: an advertised field the validator rejects,
  or a row ceiling the data plane does not apply. Deriving both from one catalog
  makes that class of bug impossible instead of merely unlikely.

  `zodToProtocolSchema` and `ProtocolSchemaAdapterError` move from
  `@hypequery/serve` to `@hypequery/datasets`, beside the builders they convert.
  `@hypequery/serve` re-exports both, so nothing importing them changes.

  The adapter also learns shape-preserving Zod refinements. A protocol schema
  cannot express a cross-field rule such as "at least one dimension or measure",
  but the rule remains enforced by the Zod validator the data plane runs.
  Transforms and preprocessors remain unsupported because they can change the
  output or accepted input shape and would make the advertised contract
  inaccurate.

## 0.15.0

### Minor Changes

- f639bd4: Carry a derived metric's authored formula in the deployment contract, so derived
  metrics execute portably instead of failing closed.

  A derived metric's contract expression already stated what the metric means: it
  inlines each input's aggregate where the formula named it. What it dropped were
  the aliases. Those are not cosmetic — they become the column names of the
  intermediate aggregate and are referenced by the outer select, so a catalog
  rebuilt without them computes the same number through different SQL. Decision
  0005 excludes a surface that cannot be made byte-identical, which is why
  `CORE-12` refused derived metrics rather than approximating them.

  `ProtocolDatasetMetric` gains an optional `derivation` carrying the inputs under
  their aliases and the formula written in terms of them. It is additive: a
  contract produced before this field stays valid, and simply remains
  non-portable. Validation proves the two forms describe one formula —
  substituting the inputs back into the authored form must reproduce the inlined
  one exactly — so they cannot disagree silently. Inputs are ordered, not sorted,
  because each becomes a column of the intermediate result in that order.

  A derivation is also held to the grammar a formula can be rebuilt from, which is
  narrower than RFC 0003: arithmetic over references and the five formula
  functions, with a literal only as a `round` precision or a `coalesce` fallback.
  Accepting a comparison, or a one-argument `round`, would publish a contract that
  validates and then fails at the point of use. Eligibility follows the metric's
  expression rather than its `kind`, because `kind` reports `grained-metric` for
  both a base metric pinned to a grain and a derived one.

  `rehydrateProtocolDatasets` rebuilds the formula by calling the same helpers in
  `formulas.ts` that authored it, rather than compiling the expression to SQL a
  second time. Those helpers carry the `toSQL` closures that decide spacing,
  parenthesisation, and function spelling, so byte-identity is structural rather
  than reimplemented and cannot drift.

  The `CORE-16` equality harness now covers derived metrics across every axis it
  already generated — grouping, all five grains, filters, ordering, pagination,
  joins, and tenant predicates — over every formula helper, including a derived
  metric pinned to a grain, whose `kind` reports `grained-metric` rather than
  `derived-metric`. A metric whose contract omits the formula still fails closed
  with `unsupported-capability`, in both rehydration and the portable executor.

- b0911ce: Add portable native execution of a semantic invocation (decision 0005).

  `createPortableSemanticExecutor()` in `@hypequery/datasets` resolves a dataset
  or metric from the validated active contract, rebuilds its catalog, and plans
  the query with the existing semantic planner. No customer module is loaded and
  no isolated runtime is required, so a bundle answers dataset and metric calls
  without a separately loaded MCP config. It applies the resolved tenant,
  propagates deadlines and cancellation to the database request, and byte-limits
  the result. A request the deadline aborts is reported as the budget it overran
  rather than as the driver's generic failure, so a caller can tell a query that
  ran out of time — worth retrying with less — from a broken or unreachable one.

  A resolved tenant that the rebuilt dataset has no field to scope by is refused
  before a query is built. That is the one failure that is otherwise silent: the
  runtime accepts the tenant, the planner emits no predicate, and the query reads
  every tenant while each layer believes tenancy was enforced. Contract validation
  already refuses to publish that shape, but the executor is exported on its own
  and typed structurally, so it cannot assume a caller went through the validator.

  A target portable execution cannot reproduce fails closed with
  `unsupported-capability` rather than being approximated — a derived metric,
  whose symbolic expression contract v1 does not carry until `CORE-17`. A single
  such metric no longer makes the rest of a deployment unexecutable:
  `rehydrateProtocolDatasets` gains `onUnsupportedMetric: 'skip'`, and the
  requested target is refused at the point of use instead.

  The deployment data plane now honours a failure category an injected executor
  claims for itself, from a fixed allow-list, so a capability gap is reported as
  one rather than as a broken query. A claim is granted by an explicit marker on
  the error rather than by its shape: a provider or library exception that happens
  to carry a generic `category` — a `not-found` from an HTTP client, say — cannot
  put its own message in front of a caller or decide whether the call is retried.
  An executor that claims nothing, that claims a category it may not (such as
  `forbidden`), or that never opted in, still reports `executor-failed` with the
  generic message. `PortableExecutionTenantError` joins the exported unsupported
  and budget errors that carry the marker.

  Deadline expiry and caller cancellation now settle execution independently of
  adapter cooperation while also aborting the underlying request. An adapter
  that ignores cancellation cannot return a successful response after the deadline
  or keep the invocation pending indefinitely.

- f72bba8: Add `queryableDatasets` to `buildCanonicalSemanticQuerySchemas` options: the
  datasets that may be named as a direct query target, defaulting to all of them.

  A dataset left out still contributes its metrics and can still be joined to; it
  is only withheld from the `query_dataset` schema. That split exists because a
  deployment contract authorizes a dataset and each of its metrics through
  separate endpoint policies, so a caller can be entitled to a metric on a dataset
  it may not query directly. Compiling one schema for both cases would either
  advertise a target the caller cannot use or hide a metric it can.

### Patch Changes

- Updated dependencies [f639bd4]
- Updated dependencies [0ba2fa6]
  - @hypequery/protocol@0.13.0

## 0.14.0

### Minor Changes

- 9289c14: Add a typed dataset publishing builder for attaching and aliasing named metrics without object spreading, and re-export it from Serve's dataset API.
- a061a60: Add `rehydrateProtocolDatasets()`, which rebuilds executable datasets from a
  validated deployment contract — the inverse of `buildProtocolDatasetContract`.
  This is what makes decision 0005's portable native execution possible: a runtime
  resolves a dataset from the active contract and plans with the existing semantic
  planner, loading no customer module.

  Rehydration routes through the public `dataset()` factory, so a rebuilt dataset
  is constructed by the same code path as an authored one. Contract → catalog →
  contract is an identity, and a rebuilt registry projects the same agent-safe
  catalog as the contract it came from.

  A rebuilt metric is pinned to the dimensions, filters, and grains the contract
  declared rather than re-deriving them from the dataset, so rehydration cannot
  widen what a deployment published. Anything portable execution cannot rebuild —
  a derived metric, whose symbolic expression contract v1 does not carry — throws
  `UnsupportedContractFeatureError` instead of executing an approximation.

- 3689e0f: Enforce `limits.maxResultSize` for queries that set no limit of their own. Query validation already rejected a limit _above_ the ceiling, but both validators guard on `query.limit != null`, so an unbounded query skipped the ceiling entirely and streamed whatever the table held. A ceiling that only binds callers who happened to name a limit is not a ceiling. Bounding is reported in `meta.resultLimit`, never applied silently — a caller who asked for everything and received 1,000 rows could not otherwise tell a bounded answer from a complete one.

  Add `cache` to `DatasetConfig`: a declared result-cache policy with `ttlMs` (the default when the caller and client supply none) and `maxTtlMs` (a ceiling on any caller- or client-supplied TTL, and on the stale-while-revalidate window layered on it). Whether a result is still-filling or already final is known by whoever defined the model, not by a caller three packages away. A call may still shorten the window or bypass the cache entirely; it can never extend one past `maxTtlMs`. The precedence rule mirrors `resolveCompiledDeadline` in `@hypequery/clickhouse`. `maxTtlMs` clamps the client-level default as well as call-level values, and bounds the _total_ servable age (`ttlMs + staleWhileRevalidateMs`) rather than each window separately. It is a ceiling, not a default: when no layer supplies a TTL, the result stays uncached.

- be0a850: Validate dataset definitions structurally when `dataset()` is called, instead of letting a malformed model fail on the first query that reaches the broken part of it. Datasets are normally defined at module scope, so an invalid one now fails at import — in the build, in CI, and in the first test that touches the module.

  `source`, `tenantKey`, `timeKey`, dimension columns and measure fields are checked as SQL identifiers, since each is interpolated into generated SQL. `tenantKey` matters most: it becomes a predicate on every query against a tenant-scoped dataset, and a typo previously constructed cleanly.

  Raw `sql` expressions on dimensions and measures are rejected when they carry a statement terminator or comment opener (`;`, `--`, `/*`), because the value is spliced into a larger expression. A declared `dependencies` entry the expression never references is also rejected — the definition would otherwise claim to read a column it does not read.

  Dimension and measure names are checked as identifiers too, since they appear in query inputs, generated tool schemas, and protocol artifacts. Previously a name was only checked indirectly, via the column it defaulted to, so the same bad name passed or failed depending on whether an explicit `column` was set.

  `limits` values must be positive integers.

- 3a28cf0: Enforce `groupable: false` in generated query schemas. A dimension declared
  non-groupable — typically one that exists only to back a measure — is no longer
  accepted as a `dimensions` or `orderBy` selection by `query_dataset` or
  `query_metric`. It previously passed schema validation even though the
  agent-safe catalog hid it, so a dataset advertised one set of dimensions and
  accepted another.

  This applies across a queryable relationship too: a target dimension marked
  non-groupable is no longer offered as `<relationship>.<dimension>` grouping key.

  Filterability is unaffected: a dimension that is filterable but not groupable
  remains usable as a filter field, locally and over a relationship.

- 916eef3: Propagate semantic query cancellation through the datasets client and ClickHouse
  semantic backend, and enforce MCP query deadlines and serialized-response byte
  ceilings with stable budget error classifications.
- 969bea6: Add bounded agent-oriented descriptions, examples, synonyms, formats, units, currency, timezone, freshness, ownership, sensitivity, and query defaults across dataset catalogs and deployment contracts.
- 3a28cf0: Add deterministic agent-safe catalog projections for local datasets and portable deployment contracts, with physical diagnostics isolated behind an explicitly authorized trusted-debug API.
- d347f89: Add a canonical catalog-derived semantic query schema compiler with shared Zod
  validators, JSON Schemas, exact field and operator constraints, bounded closed
  objects, and deterministic manifest hashing. Migrate Serve and MCP query schemas
  to the shared compiler.

### Patch Changes

- Updated dependencies [abd39a9]
- Updated dependencies [969bea6]
- Updated dependencies [7a1a5c6]
  - @hypequery/protocol@0.12.0

## 0.13.6

### Patch Changes

- 6c1bcb6: Normalize non-null dataset measure and metric results to strings across query-builder and in-memory execution, preserve SQL nulls, and update public result types to `string | null`.

## 0.13.5

### Patch Changes

- 8d08644: Declare `zod` as an optional peer dependency so package managers warn when a
  zod 4 install is hoisted over the zod 3 these packages build against.

  Both packages depend on `zod@^3` but declared no peer range, so
  `npm install @hypequery/serve zod` silently resolved zod 4 at the top level with
  no warning. The first `query({ input: z.object(...) })` then failed to compile
  with `Type 'ZodObject<...>' is missing the following properties from type
'ZodType<any, any, any>': _type, _parse, _getType, _getOrReturnCtx, and 7 more`,
  which gives no hint that a version mismatch is the cause.

  The peer is marked optional, so nothing breaks for consumers who never install
  zod directly. Quick Start now pins `zod@^3` in its install commands.

## 0.13.4

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0

## 0.13.3

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/protocol@0.10.2

## 0.13.2

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0

## 0.13.1

### Patch Changes

- f4be6bb: Fix tenant isolation when a tenant-less base dataset joins a tenant-scoped
  relationship target. Joined results are now partitioned per runtime tenant in
  the result cache, and queries that activate a tenant-scoped relationship must
  provide a runtime tenant or the explicit trusted cross-tenant scope. Queries
  that touch no tenant-scoped target continue to share cache entries as before.

## 0.13.0

### Minor Changes

- 05ebed8: Add a SQL portability compiler that parses the supported ClickHouse SQL-expression subset into RFC 0003 expression ASTs, returning source-located incompatibility issues for unsupported syntax with bounded input size, depth, and node limits.

## 0.12.7

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0

## 0.12.6

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/protocol@0.8.0

## 0.12.5

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/protocol@0.7.0

## 0.12.4

### Patch Changes

- Updated dependencies [268818b]
  - @hypequery/protocol@0.6.0

## 0.12.3

### Patch Changes

- Updated dependencies [3a8cad6]
  - @hypequery/protocol@0.5.0

## 0.12.2

### Patch Changes

- Updated dependencies [b92a0a1]
  - @hypequery/protocol@0.4.0

## 0.12.1

### Patch Changes

- Updated dependencies [05d2a4d]
  - @hypequery/protocol@0.3.0

## 0.12.0

### Minor Changes

- 28e998f: Add the portable Dataset deployment contract, strict protocol validation, and
  Dataset/Serve adapters for producing deployment artifacts from existing
  definitions.

### Patch Changes

- Updated dependencies [28e998f]
  - @hypequery/protocol@0.2.0

## 0.11.0

### Minor Changes

- a84beb8: Add cache observability to the semantic query cache: `SemanticQueryCache.getStats()` (hit/miss/stale counters, hit rate, clear support) and `clear()`, exposed on `DatasetClient` as `getCacheStats()` and `clearCache()`. Counters are per client instance; bypassed calls are not counted.

  Compatibility note: `getCacheStats()` and `clearCache()` are **required** members of the exported `DatasetClient` interface. Clients created by `createDatasetClient` gain them automatically, but hand-rolled implementations or test doubles that `implements DatasetClient` must add both members (delegating to a `SemanticQueryCache`, or returning empty stats and `false`) to compile after upgrading. This ships as a minor deliberately: the package is 0.x, where interface-breaking additions land in the minor slot, and the members are not optional so consumers never have to guard against `undefined`.

## 0.10.0

### Minor Changes

- 379998a: Add analytical dataset measures for percentiles, medians, argMax/argMin, sample standard deviation, and sample variance. The measures execute through the ClickHouse builder, ClickHouse semantic backend, and in-memory backend, and are surfaced in dataset catalogs and semantic contracts.

## 0.9.0

### Minor Changes

- b6b5111: Relationship-aware semantics: to-one relationships are now queryable end to end, and every metadata surface advertises them.

  **Querying (`@hypequery/datasets`, `@hypequery/clickhouse`):** dataset and metric queries can select, filter, and order by to-one related fields one hop deep (`dimensions: ['customer.country']`). Traversal executes as a ClickHouse `LEFT ANY JOIN` (new `leftAnyJoin` query-builder method), so base rows survive, duplicate target join keys can never fan out aggregates, and production matches the in-memory backend's first-match semantics. When runtime tenancy is active, joined targets with a `tenantKey` are scoped inside the join condition. `hasMany` remains metadata-only, and result row types include qualified fields (`row['customer.country']` is typed).

  **Metadata:** the catalog and semantic contract expose `queryable` and `fields` per relationship (replacing `execution: 'metadata_only'`; `SEMANTIC_CONTRACT_VERSION` is now 2). Generated agent tools, Serve's Zod/OpenAPI input schemas, and MCP `get_dataset_schema` all advertise the same qualified field names the validators accept — including for config-shaped datasets in MCP. Serve no longer advertises dimensions as filterable when a dataset explicitly declares `filters: {}`.

  **Validation:** `dataset()` now rejects relationship names that match the dataset's source table (the join alias would shadow the base table) or contain dots — both configurations previously failed confusingly at query time.

  **Deprecations (no removals, no behavior changes):** the plan/backend execution path is frozen in favor of `createDatasetClient({ queryBuilder })`. `createBackend`, the `backend` client option, `createInMemoryBackend`, and the `PlanNode`/`SemanticBackend` protocol exports are `@deprecated` and receive bug fixes only.

## 0.8.0

### Minor Changes

- 53f6149: Type semantic query measure and metric values as `string` instead of `number`.

  ClickHouse serializes aggregate results (`UInt64`, `Decimal`, ...) as strings
  over JSON, and the query builder already types aggregation outputs as `string`.
  The dataset/metric result row types (`DatasetRow`, `DatasetRowFor`, `MetricRow`,
  `MetricRowFor`, and the `@hypequery/react` hook rows inferred through
  `@hypequery/serve`) previously typed those same values as `number`, so a typed
  row claimed `revenue: number` while the runtime handed back `"1234.56"`. The
  types now match runtime.

  `createInMemoryBackend` now serializes measure/metric values as strings too, so
  it stays a faithful double of the ClickHouse backend (values are still computed
  and ordered numerically — only the emitted columns are stringified).

  **Breaking (types only):** code that assigned a measure or metric value
  straight into a `number` — e.g. `const revenue: number = row.revenue` — will no
  longer compile. Parse at the edge instead: `Number(row.revenue)` (or
  `parseFloat`). Dimension values are unchanged; only aggregated measure/metric
  columns are affected.

## 0.7.0

### Minor Changes

- 4fed0a7: Semantic query result caching keyed by the query signature.

  `createDatasetClient` accepts `cache: { ttlMs, staleWhileRevalidateMs, maxEntries, store, scope }`;
  results are keyed by the canonical query signature (target, dimensions,
  measures, filters, ordering, pagination, grain, tenant scope, and cache
  scope), so different queries never share entries and tenant-scoped datasets
  are partitioned per tenant. Per-call controls via `ExecutionContext.cache`
  (`{ ttlMs }` to opt in, `false` to bypass, `mode: 'refresh'` to force a
  fresh execution and re-store). Errors are never cached, concurrent identical
  queries share one execution — including against async stores — and hits
  carry `meta.cache = { hit, ageMs, stale? }`.

  Custom stores (e.g. Redis) degrade gracefully: a failed read is treated as
  a miss and a failed write is dropped, so a store outage means "no caching",
  never failed queries. `cache.scope` partitions entries when the same query
  can run against different data sources — client-level for clients sharing
  one store, per-call when overriding the query builder at runtime (unscoped
  builder overrides skip the cache entirely).

  Serve metric and dataset entries with a `cache` value now cache results
  server-side with that TTL (previously the value only emitted `Cache-Control`
  headers, which POST semantic endpoints cannot use). Dataset endpoints now
  execute through the shared `DatasetClient`, so metric and dataset entries
  share one result cache per API.

## 0.6.0

### Minor Changes

- 98ad4b6: Accept schema-typed query builders at semantic entry points without casts.

  `createQueryBuilder<Schema>` results narrow column parameters to literal
  unions, type `execute()` rows concretely, and overload `where`, so they could
  not structurally satisfy `QueryBuilderFactoryLike` — passing the documented
  `createDatasetClient({ queryBuilder: db })` / `createAPI({ queryBuilder: db })`
  pattern failed to compile for typed-schema users.

  Public acceptance points (`CreateDatasetClientOptions.queryBuilder`,
  `SemanticExecutionRuntime.builderFactory`, serve's `ServeConfig.queryBuilder`)
  now take the new `QueryBuilderFactoryInput`, which admits both protocol-shaped
  and schema-typed builders. The strict `QueryBuilderFactoryLike` remains the
  internal call contract; the exported `toQueryBuilderFactory` adapter converts
  between them.

## 0.5.0

### Minor Changes

- d7259f0: Tighten semantic API type inference, add projection-aware dataset and metric result
  types, preserve projected rows through React analytics hooks, and add static manifest
  generation for Next.js clients.

  BREAKING (types only, no runtime change): dataset and metric result rows are now
  projection-typed. `DatasetQueryResultFor` / `MetricResultFor` rows — including the
  `output` types produced by `InferApiType` / `InferAPIType` and the result of
  `createDatasetClient().execute()` — no longer expose dimension keys or `period`
  unless the query selects them via `dimensions` / `by`. Code that read dimension
  fields off default (non-projected) result types must now pass the projection in
  the query it executes.

## 0.4.0

### Minor Changes

- 12ee5e6: Add a stable, hashable semantic contract export.

  `@hypequery/datasets`:

  - Add `serializeSemanticContract`, `contractToStableJson`, `hashContract`, and `SEMANTIC_CONTRACT_VERSION`. The contract is a deterministic, sorted projection of the dataset catalog (dimensions, measures, metrics, filters, relationships, tenant/time policy, limits) with a version marker and SHA-256 content hash, so logically equal models produce identical JSON and hashes. This is the shared source for snapshots, diffs, CI validation, docs, and codegen.
  - `serializeSemanticContract` accepts `{ includeSql }` (default `true`) to omit raw SQL escape hatches for untrusted consumers.
  - Export the `DatasetCatalogSource` type.
  - Adds a dependency on `@noble/hashes` for the contract content hash, keeping the package isomorphic (no `node:crypto`).

  `@hypequery/serve`:

  - Expose the contract via a `GET /contract` endpoint (configurable through `semanticPaths.contract`) that serializes the registered datasets with their named metrics grouped onto each dataset. Raw SQL is redacted on this public endpoint by default.

## 0.3.0

### Minor Changes

- 236ce16: Add catalog-backed semantic tool generation and harden SQL exposure across MCP and generated tools.

  `@hypequery/datasets`:

  - Add `generateDatasetTools` with `catalog`, `per-dataset`, and `per-metric` modes, plus `toOpenAITools`, `toAISDKTools`, and `toMcpTools` adapters. Generated tools validate agent inputs against catalog metadata and redact SQL from results by default.
  - Expand the dataset catalog with default filter operators, filter value types, supported time grains, tenant requirement, orderable fields, max result limit, and measure filter counts.
  - Export `SEMANTIC_FILTER_OPERATORS` and `SUPPORTED_TIME_GRAINS` and use the shared operator list across packages.

  `@hypequery/serve`:

  - Build semantic input schemas and endpoint descriptions from catalog metadata, including supported grains, filters, relationships, and tenant scoping.

  `@hypequery/mcp`:

  - Distinguish measures from named metrics in dataset listing and introspection (`metricCount` no longer falls back to the measure count).
  - Add an `includeSql` server option (default `false`) so `get_dataset_schema`, `query_dataset`, and `query_metric` no longer expose generated SQL to agents unless explicitly enabled for trusted debugging.

## 0.2.1

### Patch Changes

- e6734be: Add dataset catalog metadata for measures, filters, relationships, limits, and attached named metrics. Update MCP dataset introspection and dataset querying metadata to distinguish measures from named metrics.

  Breaking MCP change: `query_dataset` now accepts `measures` only. The previous `metrics` argument for dataset queries has been removed so named metrics remain reserved for `query_metric`.

## 0.2.0

### Minor Changes

- 75349dd: Introduce the unified semantic dataset client and execution architecture.

  `createDatasetClient` now executes both datasets and metrics through either the
  query-builder protocol or a database-specific semantic backend. The package
  adds neutral semantic plans, an in-memory backend, dataset query execution,
  derived-metric validation, and a public internal protocol export for adapters.

  Query validation now covers dataset limits, field/operator compatibility,
  derived metric grouping, pagination input, and supported time grains. Runtime
  tenant predicates are injected consistently, and attempts to override enforced
  tenant filters are rejected.

- 69b67c0: Add offset pagination with reliable `hasMore` and infinite-query hooks.

  Metric and dataset queries that specify a `limit` now return
  `meta.pagination = { limit, offset, hasMore }`. `hasMore` is exact: the executor
  over-fetches one row (`LIMIT n + 1`) and trims it, so no separate count query is
  needed. The extra field is included in the serve endpoints' OpenAPI response
  schema (surfaced when meta is requested via `x-include-meta`).

  `@hypequery/react` adds `useInfiniteQuery` (and `useInfiniteMetric` /
  `useInfiniteDataset` on `createAnalyticsHooks`) built on TanStack Query's infinite
  query. They advance the offset using `meta.pagination`, automatically requesting
  meta, so paginating a dataset is just `fetchNextPage()` until `hasNextPage` is
  false.

  Metric endpoints now treat the page-size `limit` like dataset endpoints: a
  configurable `maxLimit` on the metric entry (defaulting to the dataset's
  `limits.maxResultSize`, else 1000), with over-limit requests **clamped** rather
  than rejected, and a default cap applied so a metric query is never unbounded.

- 2f3c293: Thread dataset field types through the generated API type for typed React hooks.

  `@hypequery/datasets` now exports typed query/result helpers
  (`DatasetQueryFor`, `DatasetRow`, `DatasetQueryResultFor`, and the
  `DatasetDimensionNames`/`DatasetMeasureNames`/`DatasetOrderableNames` name
  helpers, plus the metric equivalents).

  `@hypequery/serve`'s `SemanticDatasetEndpointMap` now specializes each dataset
  endpoint to its concrete instance, so `InferAPIType` carries field-level types.
  With `@hypequery/react`, `useDataset(name, input)` gets autocomplete and
  type-checking for `dimensions`/`measures`/`orderBy`, and result rows are typed
  by the dataset's dimensions and measures.

  Metric endpoints remain on the loose `MetricQuery`/`MetricResult` types for now:
  `MetricRef` does not preserve its dataset's concrete dimension keys, so
  field-level metric typing requires threading the dataset generics through
  `MetricRef` — tracked as a follow-up.

- 278924e: Carry a metric's dataset type through `MetricRef` for field-level metric hooks.

  `MetricRef` / `GrainedMetricRef` / `MetricHandle` (and `BaseMetricRef` /
  `DerivedMetricRef`) gain an optional `TDataset` type parameter that defaults to
  the previous wide instance, so existing usages are unchanged. `DatasetInstance.metric()`
  now returns a ref carrying its dataset's concrete dimension/measure types.

  `@hypequery/serve`'s `SemanticMetricEndpointMap` uses this to specialize each
  metric endpoint, so via `@hypequery/react` `useMetric(name, input)` gets
  autocomplete and type-checking for `dimensions`/`orderBy`, and result rows are
  typed by the dataset's dimensions plus the metric's value column. This completes
  the typed-hooks work started for datasets; metric endpoints degrade gracefully to
  loose `string` fields when a ref has been widened.

### Patch Changes

- ad42b98: Fix three semantic-layer deviations surfaced by manual testing.

  - **SQL-backed measures now carry through metrics.** A metric built from a
    measure with a `sql` override (e.g. `measure.sum('amount', { sql: 'amount * 1.2' })`)
    previously dropped the override on the query-builder path, emitting a plain
    `SUM(amount)`. The override is now threaded through `AggregationSpec`, so the
    metric compiles to `SUM(amount * 1.2)` like the dataset path already did. The
    semantic (non-SQL) backend rejects such metrics with a clear error instead of
    silently ignoring the expression.
  - **Unsupported time grains are rejected.** `by: 'hour'` (or any grain outside
    `day | week | month | quarter | year`) now fails validation with
    `Unsupported time grain "hour"` instead of emitting `undefined(created_at)`.
    The planner also throws defensively if it ever receives an unknown grain.
  - **`quoteSQLIdentifier` uses ClickHouse backtick quoting** (`` `col` ``) rather
    than ANSI double quotes, escaping embedded backticks by doubling them.
