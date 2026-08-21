# Manual product test journeys

These end-to-end specs test each published package against a real ClickHouse database and leave behind artifacts a reviewer can inspect: generated projects, SQL, OpenAPI, route manifests, MCP responses, or a running React UI.

| Journey | Proves |
| --- | --- |
| [CLI](./cli-testing-spec.md) | Init, schema generation, and local development |
| [Datasets](./datasets-testing-spec.md) | Semantic SQL and results against raw ClickHouse ground truth |
| [Serve](./serve-testing-spec.md) | Queries, metrics, datasets, auth, CORS, limits, and observability |
| [MCP](./mcp-testing-spec.md) | Agent discovery and governed analytics tools over stdio |
| [React](./react-testing-spec.md) | Typed hooks rendering live Serve data |
| [Type safety](./semantic-type-safety-manifest-testing.md) | Semantic inference and static route manifests |

## Database setup

Set `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD` for an existing populated database. The journeys inspect the schema, choose suitable fields, and compare semantic results with raw SQL over the same data.

Tests are read-only except the optional CLI schema-refresh journey, which creates and drops a clearly named temporary table and requires DDL privileges.

## Recommended order

1. CLI creates the working analytics project.
2. Datasets defines the shared test model and verifies SQL.
3. Serve publishes the model and writes OpenAPI and route manifests.
4. MCP queries the same model through tools.
5. React consumes the running Serve API.

Treat every documentation mismatch found during a journey as a product bug. Record new findings in the journey appendix and fix the source documentation or behavior separately from the test result.
