# @hypequery/clickhouse Changelog

## [1.3.10]

### Features

* add predicate-builder callbacks (with ClickHouse function + logical helpers) to `where`/`orWhere`, enabling predicates like `hasAny(tags, ['foo','bar'])` without raw SQL; columns/arrays are inferred automatically and `expr.raw()` provides an escape hatch for edge cases
* teach expressions and select clauses their result types, so aliased expressions (e.g. `rawAs<number, 'avg_total'>`) flow through to the query output and expression helpers know whether they produce booleans, numbers, etc.

# [0.2.0](https://github.com/lureilly1/hypequery/compare/v0.1.0...v0.2.0) (2025-03-17)


### Features

* improve streaming functionality with json() method support ([0f00b72](https://github.com/lureilly1/hypequery/commit/0f00b7297d025868427e9c7b579f0b4b97703eff))
