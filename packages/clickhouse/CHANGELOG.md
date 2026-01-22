# @hypequery/clickhouse Changelog

## [1.5.0]

### Breaking Changes

* **DateTime type mapping correction**: `DateTime`, `DateTime64`, `Date`, and `Date32` columns are now correctly typed as `string` instead of `Date`. This matches the actual runtime behavior of `@clickhouse/client` when using JSON output formats (like `JSONEachRow`), which return DateTime values as strings to preserve sub-millisecond precision that JavaScript `Date` objects cannot represent.

  **Migration guide:**
  ```typescript
  // Before (would fail at runtime):
  const results = await db.table('products').select(['created_at']).execute();
  results[0].created_at.toISOString(); // TypeError: toISOString is not a function

  // After (correctly typed):
  const results = await db.table('products').select(['created_at']).execute();
  // TypeScript now correctly knows created_at is a string
  const date = new Date(results[0].created_at); // Convert to Date when needed
  date.toISOString(); // Works!
  ```

  **Why this change:** Previously, TypeScript indicated these fields were `Date` objects, but at runtime they were actually strings. This caused type mismatches and runtime errors. The fix surfaces this at compile time, preventing bugs.

## [1.4.0]

### Features

* add an experimental caching layer that plugs into every `execute()` call: supports `cache-first`, `network-first`, and `stale-while-revalidate` modes, per-query overrides, tag invalidation, in-flight dedupe, cache-aware logging metadata, and a `CacheController` API for warming or inspecting hit stats. Ships with a memory LRU provider plus serialization helpers and provider hooks for custom stores.

* expand the example dashboard with a cache demo page (`/cache`), refresh/invalidate buttons, warming + stats API routes, and environment toggles so developers can see cache hits/misses/stale hits in real time.

### Fixes / Improvements

* ensure cached entries default `cacheTimeMs` to `ttlMs + staleTtlMs`, fix namespace parsing in the memory provider so tag invalidation works even when the host contains a protocol, and run `mergeCacheOptionsPartial`/`initializeCacheRuntime` helpers to keep query-builder lean.

* simplify the example dashboard configuration by removing the Upstash fallback, documenting provider requirements (tag hooks/TTL handling), and adding `/api/cache/*` endpoints to warm caches and inspect hit rates.

* make `npm run test` fast again (unit + type tests only) while moving integration tests behind `npm run test:integration`, and streamline `withRelation` so chained relationships reuse a single join applier.

## [1.3.2]

### Features

* teach expressions and select clauses their result types, so aliased expressions (e.g. `rawAs<number, 'avg_total'>`) flow through to the query output and expression helpers know whether they produce booleans, numbers, etc.

* refactor the query builder around a single state object: joins now widen the visible-table set (including aliases), predicates/order/group/having all read from that state, and the new `selectConst()` helper locks in literal column inference for downstream clauses. Runtime/type tests and docs were updated to cover alias-aware joins, HAVING-on-alias flows, and `withCTE` pipelines.

**Note:** Because joins now register tables before the select clause is evaluated, builder chains that previously called `.select()` before `.join()` may surface new type errors. Reorder joins ahead of select clauses to resolve the stricter checking without a runtime change.


## [1.3.0]
### Features

* add predicate-builder callbacks (with ClickHouse function + logical helpers) to `where`/`orWhere`, enabling predicates like `hasAny(tags, ['foo','bar'])` without raw SQL; columns/arrays are inferred automatically and `expr.raw()` provides an escape hatch for edge cases
