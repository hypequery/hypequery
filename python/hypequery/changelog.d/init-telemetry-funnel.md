- `hypequery init` telemetry now reports how far setup got (`stage_reached`:
  started, connection_tested, framework_selected, confirmed or completed) and
  whether connecting to ClickHouse worked (`connection_result`: ok, failed or
  skipped), as the TypeScript CLI does. Both are fixed enums: never hosts,
  table names or anything typed at a prompt.
