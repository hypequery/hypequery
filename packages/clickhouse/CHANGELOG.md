# @hypequery/clickhouse Changelog

## [1.3.2]

### Features

* teach expressions and select clauses their result types, so aliased expressions (e.g. `rawAs<number, 'avg_total'>`) flow through to the query output and expression helpers know whether they produce booleans, numbers, etc.

* refactor the query builder around a single state object: joins now widen the visible-table set (including aliases), predicates/order/group/having all read from that state, and the new `selectConst()` helper locks in literal column inference for downstream clauses. Runtime/type tests and docs were updated to cover alias-aware joins, HAVING-on-alias flows, and `withCTE` pipelines.

**Note:** Because joins now register tables before the select clause is evaluated, builder chains that previously called `.select()` before `.join()` may surface new type errors. Reorder joins ahead of select clauses to resolve the stricter checking without a runtime change.


## [1.3.0]
### Features

* add predicate-builder callbacks (with ClickHouse function + logical helpers) to `where`/`orWhere`, enabling predicates like `hasAny(tags, ['foo','bar'])` without raw SQL; columns/arrays are inferred automatically and `expr.raw()` provides an escape hatch for edge cases