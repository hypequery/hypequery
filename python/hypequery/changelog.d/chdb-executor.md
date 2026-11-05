- Datasets can run on embedded ClickHouse with the new `chdb` extra:
  `create_chdb_executor(path)` (and `create_async_chdb_executor`) execute the
  same compiled, read-only, parameter-bound SQL in-process on chDB, with no
  server. `path` is an on-disk directory or `":memory:"`; `database=` sets
  where unqualified sources resolve. Results decode exactly as from a
  ClickHouse server.
