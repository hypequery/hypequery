# A governed ClickHouse MCP server in Python: agents query datasets, not SQL

Give Claude Code, Cursor or Claude Desktop ClickHouse analytics from Python: four tools over published datasets, tenant fixed by env, no SQL.

## Demo

`uv run agent.py` is a scripted agent (the tool calls an LLM client makes, minus the model) that launches `server.py` over stdio for tenant 153:

```text
tools: get_dataset_schema, list_datasets, query_dataset, query_metric

"How many events by type did we have in October, and the error rate?"
  page_view    7689   170  0
  api_call     4246   157  0
  query_run    2559   150  0
  login        1358   140  0
  export        669   131  0
  error         533   121  0.7786116322701688

"Show me tenant 170 instead"  ->  refused: True (MCP_INVALID_ARGUMENTS)
```

Start it with `TENANT_ID=170` and every number is Relay Works' instead. The agent never names a tenant, never sees a table it was not given, and never sees SQL. The numbers match the TypeScript twin exactly.

## Install

```bash
npx hypequery create mcp-agent-analytics-python -y
cd mcp-agent-analytics-python
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
uv sync
uv run agent.py          # the scripted walkthrough above
```

`uv` is the only requirement (`pip install uv`, or see astral.sh/uv). Every client config below launches `uv run server.py` with `TENANT_ID` fixed by the config, so the agent never chooses the tenant.

### Claude Code

This folder ships a project-scoped [`.mcp.json`](./.mcp.json): run `claude` here and approve `hypequery-seed-analytics`. Or add it yourself:

```bash
claude mcp add hypequery-seed-analytics -e TENANT_ID=153 -e CLICKHOUSE_PASSWORD=hypequery -- uv run --directory "$PWD" server.py
claude mcp list   # hypequery-seed-analytics: ... - Connected
```

Walkthrough: [ClickHouse MCP in Claude Code](https://hypequery.com/blog/clickhouse-mcp-claude-code).

### Cursor

Open this folder in Cursor; [`.cursor/mcp.json`](./.cursor/mcp.json) runs `uv run --directory ${workspaceFolder} server.py`. Enable it under Settings, MCP. Walkthrough: [ClickHouse MCP in Cursor](https://hypequery.com/blog/clickhouse-mcp-cursor).

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart. Desktop launches with a minimal `PATH`, so use absolute paths (`which uv`):

```json
{
  "mcpServers": {
    "hypequery-seed-analytics": {
      "command": "/absolute/path/to/uv",
      "args": ["run", "--directory", "/absolute/path/to/mcp-agent-analytics-python", "server.py"],
      "env": { "TENANT_ID": "153", "CLICKHOUSE_PASSWORD": "hypequery" }
    }
  }
}
```

### Codex

```bash
codex mcp add hypequery-seed-analytics --env TENANT_ID=153 --env CLICKHOUSE_PASSWORD=hypequery -- uv run --directory "$PWD" server.py
```

Walkthrough: [ClickHouse MCP in Codex](https://hypequery.com/blog/clickhouse-mcp-codex). How this differs from SQL-running ClickHouse MCP servers: [ClickHouse MCP servers compared](https://hypequery.com/blog/clickhouse-mcp-servers-compared).

## What it shows

- **Four tools, nothing else** (`server.py`): `create_mcp_server` serves `list_datasets`, `get_dataset_schema`, `query_dataset` and `query_metric`, the same tools, schemas and `MCP_*` errors as `@hypequery/mcp`. There is no `run_sql`.
- **Only what you publish** (`server.py`): each `add_dataset_endpoint(..., client_profile=ClientQueryProfile())` is an allowlist entry, and `add_client_contract_endpoint` is the catalog the tools are built from. The seed's `tenants` table is not in it, so the agent cannot see it.
- **Tenant from the launch, not the prompt** (`server.py`, `analytics/datasets.py`): `authenticate` returns a `Principal` with `TENANT_ID` from the environment, `EndpointPolicy(tenant="required")` refuses tenant-free calls, `tenant_key` injects the predicate, and a `tenant_id` filter from the agent is rejected before it reaches ClickHouse.
- **The same pipeline as HTTP, without a socket** (`server.py`): `ApiContractBackend` sends every tool call through `Api.handle`, so auth, policy and row caps are the ones an HTTP caller would meet, but nothing listens on a port. The bearer key is random per process.
- **A scripted MCP client for CI** (`agent.py`, `tests/test_smoke.py`): pytest launches the server over stdio with the official `mcp` client, checks per-tenant totals against raw SQL, the refused tenant filter and that no SQL leaks, and launches the checked-in `.mcp.json` and `.cursor/mcp.json` as written.

## Key file

`server.py` is the whole server:

```python
TENANT_ID = os.environ.get("TENANT_ID", "").strip()
# The API below is never served over HTTP: only this process's MCP backend holds the key.
SESSION_KEY = secrets.token_urlsafe(32)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, SESSION_KEY):
        return Principal(subject="mcp-agent", tenant_id=TENANT_ID)
    return None


def build_api(client: AsyncDatasetClient) -> Api:
    api = create_api(auth=authenticate)
    policy = EndpointPolicy(tenant="required", max_limit=500)
    for published in (events, subscriptions):  # the allowlist: the seed's `tenants` table is not here
        add_dataset_endpoint(api, f"/datasets/{published.name}", dataset=published, client=client,
                             policy=policy, client_profile=ClientQueryProfile())
    add_client_contract_endpoint(api)  # the catalog the MCP tools are built from
    return api


async def main() -> None:
    executor = create_async_from_sync_clickhouse_executor(connection_from_env())
    try:
        api = build_api(create_async_dataset_client(executor=executor))
        backend = ApiContractBackend(api, headers={"authorization": f"Bearer {SESSION_KEY}"})
        tools = await ClientContractExecutor.create(backend)
        await serve_stdio(create_mcp_server(tools, name="hypequery-seed-analytics", version="0.1.0"))
    finally:
        await executor.aclose()
```

## Architecture

```text
MCP client (Claude Code, Cursor, agent.py)       server.py (stdio)                                      ClickHouse
──────────────────────────────────────────        ──────────────────────────────────────────────          ──────────
launches: uv run server.py  TENANT_ID=153  ──▶    authenticate ─▶ Principal(tenant_id=153)
tools/list                  ◀──────────────────── ClientContractExecutor: 4 tools from the client contract
query_dataset { dataset, dimensions, measures } ▶ ApiContractBackend ─▶ Api.handle ─▶ EndpointPolicy
                            ◀── { data }  (no sql)   ─▶ dataset(tenant_key) ─▶ SELECT ... WHERE tenant_id = 153 ─▶
```

## Adapt it

- **Your FastAPI app already has the API.** If you serve datasets with `create_api` (as in the FastAPI example), add `client_profile=ClientQueryProfile()` and `add_client_contract_endpoint(api)`, then run `hypequery mcp app:api` with `HYPEQUERY_API_KEY` set to a key your `auth` maps to one tenant. `hypequery mcp --print-config` prints the `mcpServers` entry.
- **A deployed API instead of in-process.** `HttpContractBackend("https://.../client-contract", headers=...)`, or `hypequery mcp --client-contract-url ...`, bridges a remote hypequery API; ClickHouse credentials then never leave that server.
- **Internal, cross-tenant analytics.** Return a `Principal` without `tenant_id` and drop `tenant="required"` on a server only your team launches. Never hand that server to a customer-facing agent.
- **Budgets.** `ClientContractExecutor.create(backend, query_limits=QueryLimits(...), budget=ExecutionBudget(...))` caps rows, time and response size per tool call; `EndpointPolicy(max_limit=...)` caps every page.
- **TypeScript.** The mcp-agent-analytics example is the same server with `@hypequery/mcp`, plus a Dockerfile.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95_latency_ms` measure the agent can ask for.

## Related examples

- [mcp-agent-analytics](../mcp-agent-analytics): the same governed MCP server in TypeScript, with a Docker image.
- [fastapi-analytics-api](../fastapi-analytics-api): the same Python datasets served over HTTP with signed tokens.

Tested on ClickHouse 25.8 with `hypequery` 0.1.0b3 from the monorepo (the `mcp` extra; not yet on PyPI), `mcp` 2.3, Python 3.12 and uv 0.12; `claude mcp add` and `.mcp.json` checked with Claude Code 2.1 (`claude mcp list`: Connected).
