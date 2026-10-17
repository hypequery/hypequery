# Installed Python HTTP → packed MCP qualification

Run `bash scripts/smoke-python-mcp-consumer.sh` from the repository root after
installing workspace dependencies. It builds the required Node packages and
Python wheel, installs fresh tarballs outside the checkout without optional
ClickHouse peers, and compiles a strict public TypeScript consumer without
`skipLibCheck`. The SDK's Fetch type names require ES2022/DOM plus Node types.

A loopback backend starts on port 8792 using the installed wheel and minimum
FastAPI/uvicorn versions. A real MCP SDK client connects through the in-memory
MCP transport to the HTTP executor. The fixture checks four tools, a metric
alias, nullable grouping, metadata, successive pagination offsets, distinct
principal/tenant results and refusal of SQL/context overrides. The script stops
its server on success/failure and retains artifacts/logs for inspection.

This reuses the narrow SQLite wiring fixture from
[the browser journey](./python-client-browser.md), not a supported database
adapter. It proves actual MCP → HTTP → installed Python serving, but does not
certify ClickHouse execution or kill-query behavior. MCP SDK cancellation →
backend socket close is covered separately by the Node package's native-HTTP
integration test. A combined MCP → Python → live ClickHouse cancellation case
and the exact published-version journey remain release gates.

The fixture's two credentials are public seed data. Model input cannot choose a
tenant, backend origin, credential or SQL; the host configures the backend
principal, and the Python endpoint applies its current policy before execution.

Development artifacts tested on 16 October 2026: Python 0.1.0.dev0, MCP 0.9.0,
datasets 0.23.1 and protocol 0.20.0. These are workspace builds carrying the
stacked changes, not claims about already-published versions.
