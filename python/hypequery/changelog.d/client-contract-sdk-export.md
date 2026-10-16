- Add definition-only `ClientEndpointDefinition`, `ClientQueryProfile`, and
  `export_client_contract` APIs for deterministic frontend/MCP build artifacts.
  Export logical dimensions, safe related measures, target-authorized filters,
  metric output aliases, effective definition limits and ordered base defaults
  without importing FastAPI, connecting to ClickHouse, or exposing physical SQL.
