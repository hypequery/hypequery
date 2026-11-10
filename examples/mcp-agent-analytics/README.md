# A governed ClickHouse MCP server: agents query the semantic layer, not the database

Give Claude Code, Cursor or any MCP client ClickHouse analytics through four governed tools: only published datasets, no SQL, one tenant per server.

## Demo

`pnpm agent` runs a scripted agent (the exact tool calls an LLM client makes, minus the model) against the server, started for tenant 153:

```text
tools:    get_dataset_schema, list_datasets, query_dataset, query_metric
datasets: events (9 dimensions, 4 measures), subscriptions (6 dimensions, 3 measures)

"How many events by type did we have in October, and the error rate?"
  eventType   events  uniqueUsers  errorRate
  page_view   7689    170          0
  api_call    4246    157          0
  query_run   2559    150          0
  login       1358    140          0
  export      669     131          0
  error       533     121          0.7786

"Subscriptions by plan and status"
  enterprise  active    1   999

"Show me tenant 1 instead"  ->  refused (MCP_EXECUTION_FAILED)
```

Start it with `TENANT_ID=170` and every number is Relay Works' instead. The agent never names a tenant, never sees a table name it was not given, and never sees SQL.

## Install

```bash
npx @hypequery/cli create mcp-agent-analytics -y
cd mcp-agent-analytics
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install && pnpm build
pnpm agent          # the scripted walkthrough above
```

Then connect a real agent. Every config below launches the same stdio server with `TENANT_ID` fixed by the config, so the agent never chooses the tenant. Paths assume `pnpm build` has run.

### Claude Code

This folder ships a project-scoped [`.mcp.json`](./.mcp.json): run `claude` here and approve `hypequery-seed-analytics` when asked. Or add it yourself:

```bash
claude mcp add hypequery-seed-analytics -e TENANT_ID=153 -e CLICKHOUSE_PASSWORD=hypequery -- node "$PWD/dist/src/server.js"
claude mcp list   # hypequery-seed-analytics: ... - Connected
```

Walkthrough: [ClickHouse MCP in Claude Code](https://hypequery.com/blog/clickhouse-mcp-claude-code).

### Cursor

Open this folder in Cursor; [`.cursor/mcp.json`](./.cursor/mcp.json) registers the server with `${workspaceFolder}/dist/src/server.js`. Enable it under Settings, MCP. Walkthrough: [ClickHouse MCP in Cursor](https://hypequery.com/blog/clickhouse-mcp-cursor).

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart. Desktop needs absolute paths:

```json
{
  "mcpServers": {
    "hypequery-seed-analytics": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-agent-analytics/dist/src/server.js"],
      "env": { "TENANT_ID": "153", "CLICKHOUSE_PASSWORD": "hypequery" }
    }
  }
}
```

### Codex

```bash
codex mcp add hypequery-seed-analytics --env TENANT_ID=153 --env CLICKHOUSE_PASSWORD=hypequery -- node "$PWD/dist/src/server.js"
```

That writes an `[mcp_servers.hypequery-seed-analytics]` table to `~/.codex/config.toml`. Walkthrough: [ClickHouse MCP in Codex](https://hypequery.com/blog/clickhouse-mcp-codex).

### Docker

The [`Dockerfile`](./Dockerfile) builds the server into an image; the MCP client runs it with `docker run -i`, so stdio still carries the protocol:

```bash
docker build -t hypequery-mcp-agent-analytics .
```

```json
{
  "mcpServers": {
    "hypequery-seed-analytics": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--add-host=host.docker.internal:host-gateway",
               "-e", "TENANT_ID=153", "-e", "CLICKHOUSE_URL=http://host.docker.internal:8123",
               "-e", "CLICKHOUSE_PASSWORD=hypequery", "hypequery-mcp-agent-analytics"]
    }
  }
}
```

`host.docker.internal` reaches a ClickHouse on your machine; point `CLICKHOUSE_URL` at your own server otherwise.

Ask any of them "what was our error rate by event type last month?" and watch it call `get_dataset_schema` then `query_dataset`. How this differs from SQL-running ClickHouse MCP servers: [ClickHouse MCP servers compared](https://hypequery.com/blog/clickhouse-mcp-servers-compared).

## What it shows

- **Four tools, nothing else** (`src/server.ts`): `createMCPServer` exposes `list_datasets`, `get_dataset_schema`, `query_dataset` and `query_metric`. There is no `run_sql`; the agent composes dimensions and measures, hypequery writes the SQL.
- **Only what you publish** (`src/server.ts`): `publishDatasets().publish(Events).publish(Subscriptions)` is the allowlist. The seed's `tenants` table exists, but the agent cannot see it.
- **Tenant from the launch, not the prompt** (`analytics/datasets.ts`, `src/server.ts`): both datasets have `tenantKey`, so the server refuses to start without `TENANT_ID`, injects the tenant predicate on every query, and rejects a prompt-injected `tenantId` filter.
- **Descriptions are the agent's documentation** (`analytics/datasets.ts`): `label` and `description` on dimensions and measures are what `get_dataset_schema` returns, so the agent picks `errorRate` instead of guessing a formula.
- **A deterministic agent for CI** (`src/agent.ts`, `test/smoke.test.ts`): the MCP SDK client spawns the server over stdio, replays the transcript, and the smoke test checks per-tenant totals against raw SQL and that no SQL leaks. `test/client-configs.test.ts` launches the server from the checked-in `.mcp.json` and `.cursor/mcp.json` exactly as written.

## Key file

`src/server.ts` is the whole server:

```ts
const tenantId = process.env.TENANT_ID;
if (!tenantId) {
  console.error('Set TENANT_ID to the tenant this server is allowed to see, e.g. TENANT_ID=153.');
  process.exit(2);
}

export const datasets = publishDatasets().publish(Events).publish(Subscriptions).build();

await createMCPServer({
  datasets,
  analytics,
  tenantId,
  name: 'hypequery-seed-analytics',
  version: '0.1.0',
  includeSql: process.env.HYPEQUERY_MCP_INCLUDE_SQL === '1', // trusted debugging only
});
```

## Architecture

```text
MCP client (Claude Code, Cursor, src/agent.ts)        this process (stdio)                     ClickHouse
──────────────────────────────────────────────         ─────────────────────────────────────    ──────────
launches: node dist/src/server.js  TENANT_ID=153  ──▶  createMCPServer({ datasets, tenantId })
tools/list                         ◀────────────────── list_datasets · get_dataset_schema · query_dataset · query_metric
query_dataset { dataset, dimensions, measures } ────▶  publishDatasets allowlist ─▶ dataset(tenantKey) ─▶ planner
                                   ◀── { data, meta }  (no sql)                    SELECT ... WHERE tenant_id = 153 ─▶
```

## Adapt it

- **One server per tenant is the simple model.** The MCP client's launch config carries `TENANT_ID`, so a per-user Claude Code or Cursor setup is already tenant-safe. For a shared, remote server, put `createMCPServer` behind your own auth and pass the authenticated tenant as `tenantId`.
- **Internal, cross-tenant analytics.** Publish datasets without `tenantKey`, or scope with `runtime: { tenant: { scope: 'all' } }` on a server only your team can launch. Never hand that server to a customer-facing agent.
- **Metrics.** Define `Events.metric('errorRate', { ... })` style metrics and `query_metric` serves them by name, so the agent asks for "error rate" rather than composing it.
- **Budgets.** `createMCPServer` takes `queryLimits` and `executionBudget` to cap rows, time and response size per tool call.
- **Debugging.** `HYPEQUERY_MCP_INCLUDE_SQL=1` puts the generated SQL in tool results so you can see what the agent's request compiled to. Leave it off for real agents.
- **Python.** The same server in Python, launched with `uv run`: see the mcp-agent-analytics-python example.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the `p95LatencyMs` measure the agent can ask for.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): the same datasets served over HTTP with signed tokens instead of MCP.
- [mcp-agent-analytics-python](../mcp-agent-analytics-python): the same governed MCP server in Python.
- [fastapi-analytics-api](../fastapi-analytics-api): the Python version of the semantic layer.

Tested on ClickHouse 25.8 with `@hypequery/mcp` 0.11, `@hypequery/datasets` 0.29 and `@modelcontextprotocol/sdk` 1.32; the Docker image on `node:22-slim` with `@hypequery/mcp` 0.12 from npm; `claude mcp add` and `.mcp.json` checked with Claude Code 2.1 (`claude mcp list`: Connected).
