---
"@hypequery/clickhouse": patch
---

Work against ClickHouse connections running under `readonly = 1`.

The adapter sent `output_format_json_quote_64bit_integers: 1` with every query.
`readonly = 1` forbids *any* session-setting change, so every query failed:

```
Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode.
```

Two changes:

- **Best-effort setting.** When ClickHouse rejects the setting with error code
  164 (`READONLY`) and names the adapter-owned setting, the adapter drops it,
  warns once, and retries. The flag stays off for the life of the adapter, so
  later queries do not pay another round trip. Queries already in flight during
  discovery may each retry. Unrelated errors and caller-owned settings are not
  retried.
- **Connection settings now outrank the adapter's default.** Precedence is
  adapter default < connection `clickhouse_settings` < per-query settings.
  Previously the adapter applied its own value last for this flag, so a
  connection-level `clickhouse_settings` could not turn it off. Setting it
  explicitly also disables the retry path, since nothing unrequested is sent.

Note that when the fallback engages, `Int64` and wider values come back as JSON
numbers rather than quoted strings, and lose precision beyond 2^53. The warning
says so and points at the setting to make the choice explicit.
