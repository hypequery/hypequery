---
title: "ClickHouse MCP in Cursor: Setup Guide with mcp.json"
description: "Connect Cursor to ClickHouse through an MCP server by adding one entry to .cursor/mcp.json, then check the connection and ask a real question against the public ClickHouse playground."
seoTitle: "ClickHouse MCP in Cursor: Setup Guide with mcp.json"
seoDescription: "Add @hypequery/mcp to .cursor/mcp.json and Cursor's agent can query governed ClickHouse datasets and metrics. Config, real output and fixes."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-mcp-cursor
status: published
tags:
  - ClickHouse
  - MCP
---

To connect Cursor to ClickHouse, install `@hypequery/mcp`, write a config file that describes your data, and add a `clickhouse` entry to `.cursor/mcp.json` that runs `npx -y @hypequery/mcp --config <path>`. Cursor's agent then gets four MCP tools: `list_datasets`, `get_dataset_schema`, `query_metric` and `query_dataset`. It can only query the datasets and metrics you define, and there is no tool that runs SQL, so a question about "delay" always uses the same calculation.

This guide uses the public ClickHouse playground, so it works without your own server. The server side was run end to end on 2026-11-08 with `@hypequery/mcp` 0.11.3; the Cursor details come from [Cursor's MCP docs](https://cursor.com/docs/context/mcp).

## What do I need to connect Cursor to ClickHouse?

You need Cursor and Node 20 or newer. The server talks to ClickHouse through `@clickhouse/client` 1.25.0, which declares `"node": ">=20"`, so check `node --version` first.

## Step 1: install the packages

In the project you open in Cursor:

```bash
npm init -y
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
```

## Step 2: write mcp-config.mjs

The server loads a file that exports `datasets`, the registry the agent can see, and `analytics`, the client that runs queries. Save this in the project root as `mcp-config.mjs`:

```javascript
// mcp-config.mjs: a governed ClickHouse MCP server over the public ClickHouse playground
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, dataset, dimension, measure, publishDatasets } from '@hypequery/datasets';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USERNAME ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DATABASE ?? 'default',
  // The playground user is readonly = 1, which rejects the setting hypequery
  // normally sends to quote 64-bit integers. Use the server default instead.
  integerJsonEncoding: 'server-default',
});

const Flights = dataset('flights', {
  source: 'ontime',
  description: 'US domestic flights, one row per flight (public ClickHouse playground).',
  limits: { maxResultSize: 1000 },
  dimensions: {
    year: dimension.number({ column: 'Year', label: 'Year' }),
    airline: dimension.string({ column: 'Reporting_Airline', label: 'Airline code' }),
    origin: dimension.string({ column: 'OriginCityName', label: 'Origin city' }),
  },
  measures: {
    flights: measure.count('Year', { label: 'Flights' }),
    avgDepartureDelay: measure.avg('DepDelay', { label: 'Average departure delay (minutes)' }),
  },
});

const avgDepartureDelay = Flights.metric('avgDepartureDelay', { measure: 'avgDepartureDelay' });
const flightCount = Flights.metric('flights', { measure: 'flights' });

export const datasets = publishDatasets()
  .publish(Flights, { metrics: { avgDepartureDelay, flightCount } })
  .build();

export const analytics = createDatasetClient({ queryBuilder: db });
```

The labels and descriptions matter: `get_dataset_schema` returns them to the agent, and they are how it learns that `airline` holds carrier codes.

## Step 3: add ClickHouse to Cursor's mcp.json

Create `.cursor/mcp.json` in the project:

```json
{
  "mcpServers": {
    "clickhouse": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@hypequery/mcp", "--config", "${workspaceFolder}/mcp-config.mjs"]
    }
  }
}
```

Cursor resolves `${workspaceFolder}` in `command`, `args`, `env`, `url` and `headers`, so the path stays absolute without hard-coding your home directory. To use the server in every project, put the same entry in `~/.cursor/mcp.json` and replace `${workspaceFolder}/mcp-config.mjs` with the file's absolute path.

## Step 4: check that Cursor is connected

Open Customize in Cursor's sidebar and find `clickhouse`; its toggle turns the server on and off. Once it is on, the four tools appear under Available Tools in chat. If something is wrong, open the Output panel (Cmd+Shift+U on macOS) and choose MCP Logs from the dropdown. The server writes its own logs to stderr, starting with `Hypequery MCP Server started`.

## Step 5: ask a ClickHouse question in Cursor

In agent chat, ask: "Which five airlines had the highest average departure delay in 2022?" Cursor asks for approval before it uses an MCP tool by default. The `query_dataset` call for this question takes these arguments:

```json
{
  "dataset": "flights",
  "dimensions": ["airline"],
  "measures": ["avgDepartureDelay", "flights"],
  "filters": [{ "field": "year", "operator": "eq", "value": 2022 }],
  "orderBy": [{ "field": "avgDepartureDelay", "direction": "desc" }],
  "limit": 5
}
```

Result from the server on 2026-11-08, delays rounded to two decimals:

| Airline | Avg departure delay (min) | Flights |
| --- | --- | --- |
| B6 | 23.45 | 64,860 |
| F9 | 19.48 | 36,071 |
| G4 | 14.96 | 29,152 |
| YV | 14.62 | 31,099 |
| NK | 14.10 | 53,519 |

Running the equivalent SQL directly on the playground returns the same rows. The playground's 2022 data only covers January to March, which is worth telling the agent before it reads the numbers as a full year.

When the agent guesses a field name, the server tells it what exists. Asking for a `carrier` dimension returned:

```text
Error [MCP_INVALID_ARGUMENTS]: Invalid query_dataset arguments: dimensions.0: Invalid option: expected one of "airline"|"origin"|"year"
```

## How do I point Cursor at my own ClickHouse?

Add an `env` block. Cursor's `${env:NAME}` syntax reads a variable from your environment, so the password stays out of a committed file:

```json
{
  "mcpServers": {
    "clickhouse": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@hypequery/mcp", "--config", "${workspaceFolder}/mcp-config.mjs"],
      "env": {
        "CLICKHOUSE_URL": "https://your-host.clickhouse.cloud:8443",
        "CLICKHOUSE_USERNAME": "agent_reader",
        "CLICKHOUSE_PASSWORD": "${env:CLICKHOUSE_PASSWORD}",
        "CLICKHOUSE_DATABASE": "analytics"
      }
    }
  }
}
```

Cursor also accepts `"envFile": "${workspaceFolder}/.env"` for stdio servers. Then point `source` and the fields at your own tables, and remove `integerJsonEncoding` unless the user has `readonly = 1`. Without that line hypequery asks ClickHouse to quote `Int64` values, which keeps them exact above 2^53. A `readonly = 2` user accepts the setting, and the [read-only users guide](/docs/reference/readonly-users) recommends that level.

## Troubleshooting ClickHouse MCP in Cursor

Start by running the command from a terminal:

```bash
npx -y @hypequery/mcp --config /absolute/path/to/mcp-config.mjs
```

It should print `Hypequery MCP Server started` and wait. Stdout is reserved for MCP messages, so all log output goes to stderr, which is what MCP Logs shows. The usual causes:

- A relative `--config` path in the global `~/.cursor/mcp.json`. Use an absolute path there.
- Node older than 20. If your terminal gets Node from a version manager, set `command` to the absolute path that `which npx` prints.
- A `readonly = 1` user with the default integer quoting. The agent sees only `Error [MCP_EXECUTION_FAILED]: Query execution failed`, while the logs show `Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode`. Add `integerJsonEncoding: 'server-default'`.

## When should Cursor use the official ClickHouse MCP server instead?

Pick the official [mcp-clickhouse](https://github.com/ClickHouse/mcp-clickhouse) server when the agent should explore any table and write its own SQL. It is a Python server with `run_query`, `list_databases` and `list_tables` tools, and it runs queries with `readonly = 1` by default. That fits schema exploration and one-off questions. hypequery fits when the agent's numbers have to match the definitions your team already uses. See [ClickHouse MCP servers compared](/blog/clickhouse-mcp-servers-compared).

## Related

- [ClickHouse MCP overview](/clickhouse-mcp)
- [hypequery MCP docs](/docs/mcp/overview)
- [MCP safety model](/docs/mcp/safety)
- [ClickHouse MCP in Claude Code](/blog/clickhouse-mcp-claude-code)
- [ClickHouse MCP in Codex](/blog/clickhouse-mcp-codex)
- [Cursor MCP docs](https://cursor.com/docs/context/mcp)
