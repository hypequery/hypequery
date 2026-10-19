# @hypequery/mcp

A governed ClickHouse MCP server for AI agents.

`@hypequery/mcp` turns your hypequery datasets and metrics into Model Context Protocol tools for Claude, Cursor, and other MCP clients. Agents can discover and query approved analytics without receiving unrestricted SQL access or database credentials.

## Install

```bash
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
```

## Expose your semantic layer

```ts
// mcp-config.ts
import { publishDatasets } from '@hypequery/datasets';

export const datasets = publishDatasets()
  .publish(Orders, { metrics: { revenue } })
  .build();

export const analytics = createDatasetClient({ queryBuilder: db });
```

Compile the config, then start the stdio server:

```bash
npx hypequery-mcp --config /absolute/path/to/mcp-config.js
```

Add it to an MCP client:

```json
{
  "mcpServers": {
    "hypequery-clickhouse": {
      "command": "npx",
      "args": [
        "hypequery-mcp",
        "--config",
        "/absolute/path/to/mcp-config.js"
      ]
    }
  }
}
```

Now an agent can ask, “Show revenue by region for the last month,” using the same metric definition as your backend and dashboard.

## Connect to a Python HTTP backend

An existing Python server can own definitions, authorization, tenancy and SQL.
Opt its dataset/metric routes into `ClientQueryProfile` and install
`add_client_contract_endpoint` from `hypequery.serve`. The MCP bridge consumes that
endpoint's **authorized** view; an offline `build` export cannot be used as live
discovery. No Node dataset registry or Python application import is needed.

```ts
import {
  createMCPHttpExecutor,
  createMCPProtocolServer,
  connectMCPServerStdio,
} from '@hypequery/mcp';

const url = process.env.HYPEQUERY_CLIENT_CONTRACT_URL;
const token = process.env.HYPEQUERY_API_KEY;
if (!url || !token) throw new Error('Configure the backend discovery URL and credential.');

const executor = await createMCPHttpExecutor({
  url,
  headers: { authorization: `Bearer ${token}` },
});
await connectMCPServerStdio(createMCPProtocolServer({ executor }));
```

The URL is the full discovery endpoint, including its mount prefix. HTTPS is
required except for loopback development. URLs cannot contain credentials,
queries or fragments. Keep one executor/session per principal; a headers resolver
may rotate credentials for that same principal. Browser code must never contain
this server credential. Remote MCP hosting/OAuth is a separate transport concern.

The four tool names stay the same. HTTP mode preserves each authorized endpoint's
own dimensions, filters, defaults, time controls and limits. Metric-only groups
have `queryable: false`; inspecting them does not invent a dataset query route.
Introspection returns endpoint profiles rather than merging permissions into a
synthetic dataset. Unsupported segments, SQL/debug options and caller-selected
tenants, tokens, origins or routes are rejected before backend requests.

HTTP query responses preserve the public backend envelope: `data`, plus optional
`meta` with request ID, timing, row count, pagination and optional `cache.hit`.
Set `includeMeta: true` when the endpoint advertises metadata and use
`pagination.hasMore` with `offset + limit` to page. This differs from the existing
local executor's cache-status metadata; each mode advertises its actual output
schema. Returned rows must contain exactly the selected fields with their
advertised scalar/null types. Private diagnostics or unexpected fields fail
closed instead of being forwarded to the agent.

The bridge rechecks its authorized view before discovery, prompts and execution,
and pins each POST to the validated endpoint schema. View changes or backend 409s
invalidate the session: construct a new executor/reconnect explicitly. No query
is automatically replayed with new semantics. Backend authorization is still
checked on every request, including after discovery.

Budgets default to 30 seconds, 256 KiB discovery/manifests and 1 MiB query responses.
HTTP mode has a hard 1 MiB response ceiling, 1,000 rows/filter-list values, 10,000
JSON nodes, 1,000 members per JSON collection and nesting depth 16. Query ceilings
can be lowered through `queryLimits`; unservable default selections are refused
rather than silently changed. `executionBudget`, `catalogBudget` and
`maxContractBytes` allow smaller deployment limits. Streamed/decompressed bytes
are bounded even without Content-Length, and redirects are refused. Request
cancellation aborts the HTTP operation; the backend must carry disconnection into
its executor (the Python serve adapter does so). End-to-end ClickHouse cancellation
remains part of integrated release qualification.

A TypeScript consumer of the MCP SDK needs its Fetch/DOM type names available
(e.g. `lib: ["ES2022", "DOM"]` alongside Node types); this does not require a browser
runtime. The repository's installed-artifact smoke checks this without
`skipLibCheck` and without the optional ClickHouse peer installed.

## Tools agents receive

- `list_datasets` discovers available analytics models;
- `get_dataset_schema` explains dimensions, measures, metrics, and relationships;
- `query_metric` executes named KPIs;
- `query_dataset` explores the fields you chose to publish.

Every tool declares an output schema and returns the same result twice: MCP
`structuredContent` for clients that support typed results, and compact JSON in
the text content block for compatibility. Query metadata includes row count,
timing when available, pagination state, and cache outcome. Tools also advertise
human-readable titles and read-only, non-destructive, idempotent annotations.

Tool failures use a stable structured envelope:

```json
{
  "error": {
    "code": "MCP_INVALID_ARGUMENTS",
    "category": "correctable_input",
    "message": "Invalid query_dataset arguments: ...",
    "retryable": false,
    "correctable": true
  }
}
```

Unclassified backend failures are redacted to `MCP_EXECUTION_FAILED`; database
error details and physical SQL are not copied into agent-facing errors.

## Safer than raw SQL access

- Tool schemas come from your TypeScript semantic layer.
- Advertised schemas and runtime validation use the same canonical catalog
  compiler and deterministic manifest hash.
- Filters, fields, ordering, and limits are validated.
- ClickHouse credentials remain in the server process.
- SQL text stays hidden by default.
- Tenant identity comes from trusted host configuration, never the prompt.

For tenant-scoped datasets, run the server programmatically with the trusted tenant ID:

```ts
await createMCPServer({
  datasets,
  analytics,
  name: 'acme-analytics',
  version: '1.0.0',
  tenantId: session.accountId,
  queryLimits: {
    defaultResultSize: 100,
    maxResultSize: 1_000,
    maxOffset: 10_000,
  },
  executionBudget: {
    timeoutMs: 30_000,
    maxResponseBytes: 1_048_576,
  },
});
```

Every query receives a server-side limit even when the agent omits one. The
effective ceiling is the lowest applicable server or Dataset limit. Dimensions,
measures, filters, ordering, and pagination offsets also have hard package
ceilings that server configuration may lower but cannot raise.

Query calls also have a hard wall-clock deadline and UTF-8 response-byte
ceiling. Client cancellation and local deadlines propagate through the semantic
client to the backing ClickHouse request. Budget failures use the stable
`MCP_REQUEST_CANCELLED`, `MCP_QUERY_TIMEOUT`, and `MCP_RESULT_TOO_LARGE`
classifications.

## Embed in another MCP transport

The semantic executor is independent of stdio and network lifecycle. A hosted
gateway can inject its own MCP transport without reimplementing Hypequery's
tools, prompts, catalog schemas, or validation:

```ts
import {
  createMCPExecutor,
  createMCPProtocolServer,
} from '@hypequery/mcp';

const executor = createMCPExecutor({
  datasets,
  analytics,
  tenantId: trustedPrincipal.tenantId,
});

const server = createMCPProtocolServer({
  executor,
  name: 'acme-hosted-analytics',
  version: '1.0.0',
});

await server.connect(hostTransport);
```

`hostTransport` can be an MCP SDK in-memory, stdio, or hosted transport. This
package does not create an HTTP endpoint; authentication, routing, and network
lifecycle remain responsibilities of the host. For an explicit local adapter,
use `startStdioMCPServer(config)`. The existing `createMCPServer(config)` and
`HypequeryMCPServer.start()` APIs remain available for compatibility.

## Learn more

- [ClickHouse MCP overview](https://hypequery.com/clickhouse-mcp)
- [MCP configuration](https://hypequery.com/docs/mcp/configuration)
- [MCP tools](https://hypequery.com/docs/mcp/tools)
- [MCP safety](https://hypequery.com/docs/mcp/safety)
- [Current capabilities](https://hypequery.com/docs/capabilities)

## License

Apache-2.0.
