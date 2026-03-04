---
'@hypequery/clickhouse': minor
---

Add typed scalar `WITH` support for ClickHouse and improve expression ergonomics.

- add `withScalar(alias, expr => ...)` to emit scalar `WITH <expression> AS <alias>` clauses
- enforce scalar alias validation for safe unquoted SQL identifiers
- add ClickHouse predicate helper namespace `expr.ch`, including `expr.ch.dictGet(...)`
- expand unit + type test coverage for scalar aliases and typed helper usage
- document scalar `WITH` aliases in query-building docs (serve + standalone)
