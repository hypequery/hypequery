# @hypequery/clickhouse Changelog

## 3.0.0

### Patch Changes

- Updated dependencies [69b67c0]
- Updated dependencies [2f3c293]
- Updated dependencies [278924e]
  - @hypequery/datasets@0.2.0

## 2.0.2

### Patch Changes

- **SECURITY**: Fixed SQL injection vulnerability in parameter escaping. The `escapeValue()` function in `src/core/utils.ts` now properly escapes backslashes before single quotes, preventing attackers from using trailing backslashes to break out of string literals and inject arbitrary SQL. ClickHouse recognizes both SQL-standard (`''`) and C-style (`\`) escape sequences—a trailing backslash could escape the closing quote, allowing the second parameter to execute as raw SQL instead of being treated as a string literal. **All users should upgrade immediately.**

## 2.0.1

### Patch Changes

- 890c76d: Fix aggregation `GROUP BY` inference when chaining aggregate helpers without an explicit grouping dimension. Aggregate aliases such as `revenue` from `SUM(price) AS revenue` are no longer reused as inferred `GROUP BY` keys, which avoids invalid SQL like `GROUP BY revenue` when additional aggregations are appended.

## 2.0.0

### Major Changes

- 29761f3: Release `@hypequery/clickhouse` as `2.0.0` and include the related CLI patch release.

  For `@hypequery/clickhouse`, this release includes:

  - a refactor toward an explicit query-node internal model
  - stricter `withRelation()` behavior for chained relationships
  - stricter tuple `IN` validation and improved empty-set filter semantics
  - additive `groupBy()` behavior and improved aggregation inference
  - support for ClickHouse-native builder features such as `arrayJoin()`, `leftArrayJoin()`, `limitBy()`, and `withTotals()`
  - exported built-in time-bucketing helpers such as `toStartOfMinute()` through `toStartOfYear()`
  - `url` as the preferred ClickHouse connection field, while keeping deprecated `host` compatibility

  For `@hypequery/cli`, this release includes:

  - stricter non-interactive setup behavior with cleaner failure paths
  - NodeNext-safe generated scaffold imports
  - improved scaffold dependency installation, including `zod` and aligned canary sibling versions
  - support for `--skip-connection` during init scaffolding

## 2.0.0

### Major Changes

- query builder internals are now centered on a structured `SelectQueryNode` model instead of looser config mutation. This keeps the public builder workflow largely the same, but makes filtering, relation application, validation, and SQL compilation more explicit internally.

- advanced builder inspection should now prefer `getQueryNode()`. `getConfig()` still exists for compatibility, but it should be treated as a legacy inspection helper rather than the main public view of builder state.

- `withRelation()` behavior is stricter and better defined:

  - string relationship lookup still works for reusable runtime registry usage
  - direct `JoinPath` usage is the typed path for compile-time table and alias widening
  - alias override is only supported for single-step relationships, not chains

- tuple `IN` handling is stricter:

  - single-column tuple `IN` is now covered explicitly
  - tuple width is validated against the selected column width
  - malformed tuple input fails earlier with clearer errors

- add first-class `isNull` / `isNotNull` filter operators.

### Breaking Changes

- builder chains should be treated as immutable. If you are composing a query conditionally, reassign the returned builder rather than assuming methods mutate the existing instance.

  ```typescript
  let query = db.table("users");
  if (onlyActive) query = query.where("status", "eq", "active");
  if (limit) query = query.limit(limit);
  ```

- `withRelation(..., { alias })` no longer supports alias override for chained relationships. Define aliases on each step of the chain instead.

- tuple `IN` filters now fail earlier when the tuple width does not match the target column list.

### Additional Changes

- docs, examples, and scaffolding now prefer `url` over `host` for ClickHouse connection config.

- `host` remains supported as a deprecated backward-compatible option. Existing `host`-only configs should continue to work.

- adapter namespace derivation now reads either `url` or `host`, which keeps cache/namespace behavior stable across both config styles.

- fix several query-builder correctness issues around grouping, aggregation inference, and empty-set filter behavior:

  - `NOT IN []` / `GLOBAL NOT IN []` now compile to `1 = 1` instead of `1 = 0`
  - repeated `groupBy()` calls are additive and de-duplicated
  - aliased selected expressions are grouped correctly when aggregations are added later
  - explicit `groupBy()` clauses are preserved without duplicate inferred entries
  - aggregation helpers now accept qualified joined columns in their type surface

- add ClickHouse-specific builder support for:

  - `arrayJoin()`
  - `leftArrayJoin()`
  - `limitBy()`
  - `withTotals()`

  This extends the query AST, SQL renderer, type surface, and integration coverage for several common ClickHouse-native query patterns.

- tighten `arrayJoin()` and `leftArrayJoin()` typing so they only accept array-typed columns, including qualified joined columns and aliased joined columns.

- export the built-in start-of time helpers from the package entrypoint:

  - `toStartOfMinute`
  - `toStartOfHour`
  - `toStartOfDay`
  - `toStartOfWeek`
  - `toStartOfMonth`
  - `toStartOfQuarter`
  - `toStartOfYear`

## 1.6.2

### Patch Changes

- f87df2f: Fix tuple type inference in generated types to properly render positional tuple types instead of falling back to `unknown`. This includes:

  - Added `ParseTopLevelArgs` type helper to correctly parse comma-separated type arguments while preserving nested parentheses
  - Updated `InferClickHouseType` to handle `Tuple(...)` types by inferring positional TypeScript tuple types
  - Refactored CLI type-parsing logic to extract `clickhouseToTsType` into a separate module with improved tuple handling
  - Added support for nested tuple types within `Array`, `Map`, and `Nullable` wrappers
  - Added test coverage for tuple type inference scenarios

## 1.6.1

### Patch Changes

- 1fad488: Fix two ClickHouse query/type-safety issues.

  - Fix builder-level per-query settings so `.settings(...)` is forwarded at execution time via ClickHouse `clickhouse_settings` instead of being silently ignored. This also forwards `queryId` as ClickHouse `query_id`, merges repeated `.settings(...)` calls, and adds matching `rawQuery(..., options?)` support for per-query execution options.
  - Fix type inference for wide ClickHouse integers so `Int64`/`UInt64` and wider widths map to `string` instead of `number` in both core inference and generated record types. This also preserves `rawAs()` aliases in mixed `select([...])` calls so aliased raw expressions appear in `execute()` result types with `unknown` by default or the explicit generic type when provided.

## 1.6.0

### Minor Changes

- cc466d5: Add typed scalar `WITH` support for ClickHouse and improve expression ergonomics.

  - add `withScalar(alias, expr => ...)` to emit scalar `WITH <expression> AS <alias>` clauses
  - enforce scalar alias validation for safe unquoted SQL identifiers
  - add ClickHouse predicate helper namespace `expr.ch`, including `expr.ch.dictGet(...)`
  - expand unit + type test coverage for scalar aliases and typed helper usage
  - document scalar `WITH` aliases in query-building docs (serve + standalone)

## [1.5.0]

### Breaking Changes

- **DateTime type mapping correction**: `DateTime`, `DateTime64`, `Date`, and `Date32` columns are now correctly typed as `string` instead of `Date`. This matches the actual runtime behavior of `@clickhouse/client` when using JSON output formats (like `JSONEachRow`), which return DateTime values as strings to preserve sub-millisecond precision that JavaScript `Date` objects cannot represent.

  **Migration guide:**

  ```typescript
  // Before (would fail at runtime):
  const results = await db.table("products").select(["created_at"]).execute();
  results[0].created_at.toISOString(); // TypeError: toISOString is not a function

  // After (correctly typed):
  const results = await db.table("products").select(["created_at"]).execute();
  // TypeScript now correctly knows created_at is a string
  const date = new Date(results[0].created_at); // Convert to Date when needed
  date.toISOString(); // Works!
  ```

  **Why this change:** Previously, TypeScript indicated these fields were `Date` objects, but at runtime they were actually strings. This caused type mismatches and runtime errors. The fix surfaces this at compile time, preventing bugs.

## [1.4.0]

### Features

- add an experimental caching layer that plugs into every `execute()` call: supports `cache-first`, `network-first`, and `stale-while-revalidate` modes, per-query overrides, tag invalidation, in-flight dedupe, cache-aware logging metadata, and a `CacheController` API for warming or inspecting hit stats. Ships with a memory LRU provider plus serialization helpers and provider hooks for custom stores.

- expand the example dashboard with a cache demo page (`/cache`), refresh/invalidate buttons, warming + stats API routes, and environment toggles so developers can see cache hits/misses/stale hits in real time.

### Fixes / Improvements

- ensure cached entries default `cacheTimeMs` to `ttlMs + staleTtlMs`, fix namespace parsing in the memory provider so tag invalidation works even when the host contains a protocol, and run `mergeCacheOptionsPartial`/`initializeCacheRuntime` helpers to keep query-builder lean.

- simplify the example dashboard configuration by removing the Upstash fallback, documenting provider requirements (tag hooks/TTL handling), and adding `/api/cache/*` endpoints to warm caches and inspect hit rates.

- make `npm run test` fast again (unit + type tests only) while moving integration tests behind `npm run test:integration`, and streamline `withRelation` so chained relationships reuse a single join applier.

## [1.3.2]

### Features

- teach expressions and select clauses their result types, so aliased expressions (e.g. `rawAs<number, 'avg_total'>`) flow through to the query output and expression helpers know whether they produce booleans, numbers, etc.

- refactor the query builder around a single state object: joins now widen the visible-table set (including aliases), predicates/order/group/having all read from that state, and the new `selectConst()` helper locks in literal column inference for downstream clauses. Runtime/type tests and docs were updated to cover alias-aware joins, HAVING-on-alias flows, and `withCTE` pipelines.

**Note:** Because joins now register tables before the select clause is evaluated, builder chains that previously called `.select()` before `.join()` may surface new type errors. Reorder joins ahead of select clauses to resolve the stricter checking without a runtime change.

## [1.3.0]

### Features

- add predicate-builder callbacks (with ClickHouse function + logical helpers) to `where`/`orWhere`, enabling predicates like `hasAny(tags, ['foo','bar'])` without raw SQL; columns/arrays are inferred automatically and `expr.raw()` provides an escape hatch for edge cases
