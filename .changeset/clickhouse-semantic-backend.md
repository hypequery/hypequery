---
"@hypequery/clickhouse": minor
---

Add the ClickHouse backend for `@hypequery/datasets` under the new
`@hypequery/clickhouse/datasets` export. `createBackend` translates semantic
plans into ClickHouse queries, including dimensions, aggregations, derived
metrics, filters, ordering, pagination, and tenant predicates.

Type generation can now return definitions without writing a file, accept an
injected client, and recognizes additional ClickHouse types and nested wrapper
syntax. SQL literal and interval rendering is also hardened so generated
expressions safely reject malformed interval input and escape string values.
