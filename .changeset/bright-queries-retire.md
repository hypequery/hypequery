---
"@hypequery/clickhouse": patch
---

Remove the unused internal `CompiledQueryV1` execution contract and its exports.
ClickHouse continues to use the legacy positional parameter path with `?` placeholders.
