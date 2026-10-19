- Add `ClickHouseConnection.from_env()`, reading `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`,
  `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` and
  `CLICKHOUSE_SECURE`. Malformed ports and booleans are refused by variable name. An
  unset port lets the driver choose 8123, or 8443 when secure. The CLI, project
  scaffolds and examples now use it, so scaffolded apps honour `CLICKHOUSE_SECURE`.
- ClickHouse executors are context managers (`with` / `async with`) that close their
  connections on exit.
- The async executor's cancellation-control connection now uses the same 2-second
  receive timeout as the sync executor's.
