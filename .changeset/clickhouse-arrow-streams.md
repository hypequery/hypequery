---
"@hypequery/clickhouse": minor
---

Stream results as Arrow. `builder.streamArrow()` and `db.rawArrowStream(sql, params)` return the result as Arrow IPC stream bytes (ClickHouse `ArrowStream`) with native column types, for any Arrow reader to decode or for passing on unchanged. Batches are uncompressed by default, because JavaScript Arrow readers don't include the LZ4 codec; a connection-level or per-call `output_format_arrow_compression_method` overrides that. `db.rawStream(sql, params)` streams a raw statement's rows, as `builder.stream()` does for built queries. If ClickHouse fails after sending part of an Arrow result, the stream errors rather than handing the exception text to the decoder: with ClickHouse's own error on ClickHouse 25.11 or later, which marks the failure, and on older servers because the bytes end without Arrow's end-of-stream marker. Custom adapters can implement the new optional `DatabaseAdapter.streamArrow`.
