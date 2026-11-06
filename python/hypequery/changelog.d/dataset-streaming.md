- `client.stream(target, query)` and `client.stream_arrow(target, query)`
  stream a dataset query's result instead of returning it whole, so memory
  stays flat however many rows there are. `stream` yields batches of the rows
  `execute` returns; `stream_arrow` yields `pyarrow.RecordBatch`es with
  ClickHouse's native column types (`decimal128`, `uint64`), with `read_all()`
  and `to_reader()` for DuckDB, polars and pandas (`hypequery[arrow]`). Both
  run the query `execute` would, under the same settings, tenant scope,
  deadline and cancellation, without the cache or pagination. Use them as
  context managers (`async with` on the async client): closing a stream early
  stops the query, with `KILL QUERY` where a control connection is
  configured. Every ClickHouse and chDB executor streams; a result that grows
  past `max_result_rows` or `max_result_bytes` fails as `too-large` rather
  than ending short. Custom executors stream by implementing the new
  `StreamingQueryExecutor` protocol.
