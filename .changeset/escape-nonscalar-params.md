---
'@hypequery/clickhouse': patch
---

Support bigint SQL parameters and add regression coverage ensuring injection-
shaped strings nested inside arrays and objects remain contained within their
ClickHouse string literals.
