---
'@hypequery/clickhouse': minor
'@hypequery/datasets': patch
---

Add `toSQLWithPlaceholders(placeholder)` to the query builder: it compiles the query and writes each bound value through the callback, in SQL order, so a caller can number placeholders when embedding the statement in a larger one. `@hypequery/datasets` adds it as an optional `QueryBuilderLike` member, used only by datasets dialects that number placeholders. ClickHouse datasets queries keep using `toSQLWithParams`, so existing builders and generated SQL are unchanged.
