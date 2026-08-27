---
"@hypequery/clickhouse": patch
---

Add explicit support for ClickHouse connections running under `readonly = 1`.

The adapter sent `output_format_json_quote_64bit_integers: 1` with every query.
That preserves integers beyond JavaScript's safe range and matches HypeQuery's
generated `string` types. However, `readonly = 1` rejects the setting when it
differs from the user's profile, so queries can fail with:

```
Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode.
```

Two changes keep that tradeoff explicit:

- **Strict read-only mode.** Set `integerJsonEncoding: 'server-default'` on
  `createQueryBuilder` or `ClickHouseAdapter` to omit the adapter-owned setting.
  This performs no capability probe or retry. The default remains `'quoted'`
  because server-default JSON numbers can lose precision beyond 2^53 and may not
  match generated `Int64`/`UInt64` string types. If the default is rejected, the
  adapter now returns an actionable error describing this option.
- **Connection settings now outrank the adapter's default.** Precedence is
  adapter default < connection `clickhouse_settings` < per-query settings.
  Previously the adapter applied its own value last for this flag, so a
  connection-level value could not override it. Caller-owned values are never
  replaced or reinterpreted by the adapter.
