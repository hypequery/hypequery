---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
'@hypequery/cli': patch
---

SQL-sourced datasets (RFC 0028, proposed). A dataset's `source` can now be one read-only ClickHouse `SELECT`, written as `{ sql, dependencies, columns }`. This lets you model derived tables such as a `UNION ALL` activity stream. The SQL is checked when the dataset is defined: one statement, no settings, table functions, comments or parameters, and dependencies that match the tables it reads. Queries read it as a derived table aliased as the dataset, so tenant scoping and filters apply as they do for a table, and a `FINAL` inside the SQL pins `optimize_move_to_prewhere_if_final = 0`.

`@hypequery/protocol` accepts the source in dataset and deployment contracts (`{ kind: 'sql', dialect: 'clickhouse', … }`) and exports `analyzeProtocolSqlSource` and `validateProtocolSqlSource`. `ProtocolDatasetContract.source` widens to `string | ProtocolSqlSource`. Python doesn't support SQL sources yet and rejects them.

`hypequery onboard check` checks a SQL-sourced dataset's dependencies, not its alias, for missing tables, and skips its relationships in join checks.
