---
"@hypequery/clickhouse": patch
---

Remove the unused internal `CompiledQueryV1` execution contract and its exports.
There is no change to ClickHouse query construction or execution; existing queries
still use positional `?` placeholders and the established escaping path.
