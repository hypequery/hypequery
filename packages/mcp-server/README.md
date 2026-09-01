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
export const datasets = {
  orders: {
    ...Orders,
    metrics: { revenue },
  },
};

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

## Tools agents receive

- `list_datasets` discovers available analytics models;
- `get_dataset_schema` explains dimensions, measures, metrics, and relationships;
- `query_metric` executes named KPIs;
- `query_dataset` explores the fields you chose to publish.

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
