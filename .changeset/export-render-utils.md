---
"@hypequery/clickhouse": patch
---

Export `substituteParameters` and `escapeValue` from the package entrypoint so third-party adapters can reuse the same SQL parameter rendering as the built-in ClickHouse adapter.
