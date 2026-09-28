---
"@hypequery/clickhouse": minor
---

Aborting a query now stops it on ClickHouse, not just in your process. When a query or stream is passed an `abortSignal`, the adapter sends `cancel_http_readonly_queries_on_client_close = 1`, so a read-only connection (a read-only user, or `clickhouse_settings: { readonly: '2' }`) cancels the query as soon as the client aborts. Before this, ClickHouse kept running the query to completion. A value in `clickhouse_settings` still takes precedence. A `readonly = 1` connection, which rejects the setting, gets the query resent once without it and doesn't receive the setting again, so existing read-only users keep working unchanged.
