---
title: "ClickHouse MCP in Codex: Setup with codex mcp add"
description: "Connect OpenAI Codex to ClickHouse through an MCP server with codex mcp add or a config.toml entry, then check the connection and query the public ClickHouse playground."
seoTitle: "ClickHouse MCP in Codex: Setup with codex mcp add"
seoDescription: "Run codex mcp add clickhouse -- npx -y @hypequery/mcp --config ./mcp-config.mjs to give Codex governed ClickHouse datasets. TOML, output, fixes."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-mcp-codex
status: published
tags:
  - ClickHouse
  - MCP
---

To connect Codex to ClickHouse, install `@hypequery/mcp`, write a config file that describes your data, and run `codex mcp add clickhouse -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"`, or add the same server as a `[mcp_servers.clickhouse]` table in `~/.codex/config.toml`. Codex then has four MCP tools: `list_datasets`, `get_dataset_schema`, `query_metric` and `query_dataset`. They query the datasets and named metrics you define, and none of them accepts SQL, so the agent can't invent its own version of a metric.

The examples use the public ClickHouse playground. The server side was run end to end on 2026-11-08 with `@hypequery/mcp` 0.11.3 and the commands come from `codex mcp add --help` in codex-cli 0.166.0.

## What do I need to connect Codex to ClickHouse?

You need the Codex CLI and Node 20 or newer. The server's ClickHouse driver, `@clickhouse/client` 1.25.0, declares `"node": ">=20"`.

## Step 1: install the packages

```bash
mkdir clickhouse-mcp && cd clickhouse-mcp
npm init -y
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
```

## Step 2: write the config file

Save this as `mcp-config.mjs`. It must export `datasets`, the registry Codex can see, and `analytics`, the client that runs the queries:

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

## Step 3: add the server to Codex

From the folder that holds the config:

```bash
codex mcp add clickhouse -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"
```

Everything after `--` is the command Codex launches. The shell expands `$PWD`, so Codex stores an absolute path.

You can write the entry by hand instead. Codex reads MCP servers from `~/.codex/config.toml`, or from `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.clickhouse]
command = "npx"
args = ["-y", "@hypequery/mcp", "--config", "/absolute/path/to/clickhouse-mcp/mcp-config.mjs"]
cwd = "/absolute/path/to/clickhouse-mcp"
startup_timeout_sec = 30
```

`cwd` sets the server's working directory. With it pointing at the project, `npx` uses the copy in `node_modules`: in our test the server answered in about 2 seconds from the project folder, against 15 seconds on a first run from elsewhere while `npx` fetched the package. Codex gives a server 10 seconds to start by default, so `startup_timeout_sec = 30` leaves room ([Codex MCP docs](https://developers.openai.com/codex/mcp)). The Codex CLI, the IDE extension and the ChatGPT desktop app share this configuration.

## Step 4: check that Codex is connected

`codex mcp list` shows the configured servers and `codex mcp get clickhouse` prints this one's command. Inside the `codex` TUI, `/mcp` lists the active MCP servers. If `clickhouse` is missing there, see the troubleshooting section below.

## Step 5: ask Codex a ClickHouse question

Ask: "Which five airlines had the highest average departure delay in 2022?" A `query_dataset` call that answers it looks like this:

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

The server returned, with delays rounded to two decimals:

| Airline | Avg departure delay (min) | Flights |
| --- | --- | --- |
| B6 | 23.45 | 64,860 |
| F9 | 19.48 | 36,071 |
| G4 | 14.96 | 29,152 |
| YV | 14.62 | 31,099 |
| NK | 14.10 | 53,519 |

These match a direct SQL query against the playground. For a stable KPI, Codex can call `query_metric` with the named `avgDepartureDelay` metric, `dimensions: ["year"]` and a `year gte 2019` filter. That returned 10.73 minutes for 2019, 1.94 for 2020, 9.24 for 2021 and 11.20 for 2022. The 2022 figure covers only January to March, the last rows in the playground table.

## How do I connect Codex to my own ClickHouse?

Pass the connection as environment variables, which the config reads before falling back to the playground:

```bash
codex mcp add clickhouse \
  --env CLICKHOUSE_URL=https://your-host.clickhouse.cloud:8443 \
  --env CLICKHOUSE_USERNAME=agent_reader \
  --env CLICKHOUSE_DATABASE=analytics \
  -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"
```

For the password, add `env_vars = ["CLICKHOUSE_PASSWORD"]` to the `[mcp_servers.clickhouse]` table. Codex then forwards that variable from its own environment, so the value never lands in `config.toml`. Fixed values can also go in a `[mcp_servers.clickhouse.env]` table.

Change `source` and the fields to match your tables. Remove `integerJsonEncoding` unless your user has `readonly = 1`: by default hypequery asks ClickHouse to quote `Int64` values so they stay exact above 2^53. The [read-only users guide](/docs/reference/readonly-users) recommends `readonly = 2`, which accepts that setting.

## Troubleshooting ClickHouse MCP in Codex

Run the server directly:

```bash
npx -y @hypequery/mcp --config /absolute/path/to/mcp-config.mjs
```

It should log `Hypequery MCP Server started` and keep running. Logs go to stderr because stdout carries the MCP stream, so the terminal is where to read query errors. Likely causes:

- A relative `--config` path, which breaks when Codex starts the server from another directory.
- Node older than 20.
- A startup timeout on a first run outside the project. Set `cwd` or raise `startup_timeout_sec`.
- A `readonly = 1` user without `integerJsonEncoding: 'server-default'`. Codex sees `Error [MCP_EXECUTION_FAILED]: Query execution failed`, and stderr shows `Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode`.

## When is the official ClickHouse MCP server the better choice for Codex?

Use the official [mcp-clickhouse](https://github.com/ClickHouse/mcp-clickhouse) server when Codex should explore arbitrary tables and write SQL. It is a Python server with `run_query`, `list_databases` and `list_tables` tools, and it runs queries with `readonly = 1` unless you set `CLICKHOUSE_ALLOW_WRITE_ACCESS=true`. That is a good match for investigating an unfamiliar schema. hypequery is the better match once a metric has an agreed definition. [ClickHouse MCP servers compared](/blog/clickhouse-mcp-servers-compared) goes through both.

## Related

- [ClickHouse MCP overview](/clickhouse-mcp)
- [hypequery MCP docs](/docs/mcp/overview)
- [MCP safety model](/docs/mcp/safety)
- [ClickHouse MCP in Claude Code](/blog/clickhouse-mcp-claude-code)
- [ClickHouse MCP in Cursor](/blog/clickhouse-mcp-cursor)
- [Codex MCP docs](https://developers.openai.com/codex/mcp)
