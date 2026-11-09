---
title: "ClickHouse MCP in Claude Code: Set Up in 5 Minutes"
description: "Connect Claude Code to ClickHouse through an MCP server with one claude mcp add command, check the connection, and ask a real question against the public ClickHouse playground."
seoTitle: "ClickHouse MCP in Claude Code: Set Up in 5 Minutes"
seoDescription: "Run claude mcp add clickhouse -- npx -y @hypequery/mcp --config ./mcp-config.mjs to give Claude Code governed ClickHouse datasets. Steps, output, fixes."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-mcp-claude-code
status: published
tags:
  - ClickHouse
  - MCP
---

To connect Claude Code to ClickHouse, install `@hypequery/mcp` with its two companion packages, write a config file that describes your data, and register it with `claude mcp add clickhouse -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"`. Claude Code then gets four MCP tools: `list_datasets`, `get_dataset_schema`, `query_metric` and `query_dataset`. The agent queries the datasets and metrics you define in that file, and the server has no tool that runs SQL, so every number comes from one definition.

The steps use the public ClickHouse playground and were run on 2026-11-08 with `@hypequery/mcp` 0.11.3.

## What do I need before adding ClickHouse MCP to Claude Code?

You need Node 20 or newer and Claude Code. Node 20 is the floor because `@clickhouse/client` 1.25.0, which the server uses to talk to ClickHouse, declares `"node": ">=20"`. Check with `node --version`.

## Step 1: install the packages

Create a folder and install the server, the dataset layer and the ClickHouse client:

```bash
mkdir clickhouse-mcp && cd clickhouse-mcp
npm init -y
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
```

## Step 2: write the config file

The server loads one file that exports `datasets` (what the agent may see) and `analytics` (how queries run). Save this as `mcp-config.mjs`:

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

The playground's `ontime` table holds US domestic flights. Its 2022 rows run from 2022-01-01 to 2022-03-31.

## Step 3: add the server to Claude Code

Run this from the folder that holds `mcp-config.mjs`:

```bash
claude mcp add clickhouse -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"
```

Everything after `--` is passed to the server untouched. The shell expands `$PWD` first, so the saved entry holds an absolute path.

The default `local` scope loads the server only in the current project and stores it in `~/.claude.json`. `-s user` loads it in every project. `-s project` writes it to `.mcp.json` in the project root for committing, and Claude Code asks for approval before using it. In `.mcp.json`, `${VAR}` references in `command`, `args` and `env` expand from your environment, so a password can stay out of the file ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)).

## Step 4: check that Claude Code is connected

Run `claude mcp list`. A working server shows `✔ Connected`, and a broken one shows `✘ Failed to connect`. `claude mcp get clickhouse` prints the saved command and scope.

Inside a session, type `/mcp`. The panel shows each server's status with its tool count, which should be 4 for this server.

## Step 5: ask Claude a ClickHouse question

Start `claude` in the project and ask: "Which five airlines had the highest average departure delay in 2022?" The agent can call `list_datasets` and `get_dataset_schema` to learn the `flights` fields, then `query_dataset` with these arguments:

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

The server returned these rows on 2026-11-08 (delays rounded to two decimals):

| Airline | Avg departure delay (min) | Flights |
| --- | --- | --- |
| B6 | 23.45 | 64,860 |
| F9 | 19.48 | 36,071 |
| G4 | 14.96 | 29,152 |
| YV | 14.62 | 31,099 |
| NK | 14.10 | 53,519 |

Plain SQL against the playground gives identical numbers. A call that names an undefined field fails with `MCP_INVALID_ARGUMENTS`, listing the valid fields, so the agent can retry. The [tools reference](/docs/mcp/tools) lists every argument and error code.

## How do I use my own ClickHouse server?

Pass your connection as environment variables, which the config reads before it falls back to the playground:

```bash
claude mcp add clickhouse \
  -e CLICKHOUSE_URL=https://your-host.clickhouse.cloud:8443 \
  -e CLICKHOUSE_USERNAME=agent_reader \
  -e CLICKHOUSE_PASSWORD=your-password \
  -e CLICKHOUSE_DATABASE=analytics \
  -- npx -y @hypequery/mcp --config "$PWD/mcp-config.mjs"
```

Then change `source`, the dimensions and the measures to match your tables. Delete the `integerJsonEncoding` line unless your user has `readonly = 1`. Without it, hypequery asks ClickHouse to quote `Int64` values so they stay exact; with it, values past 2^53 can lose precision. The [read-only users guide](/docs/reference/readonly-users) recommends a `readonly = 2` user, which accepts that setting.

## Troubleshooting ClickHouse MCP in Claude Code

If `claude mcp list` says `✘ Failed to connect`, run the server yourself:

```bash
npx -y @hypequery/mcp --config /absolute/path/to/mcp-config.mjs
```

It should print `Hypequery MCP Server started` and keep running until you press Ctrl+C. The server writes logs to stderr because stdout carries the MCP protocol, so the terminal is the easiest place to read them. Common causes:

- A relative config path. Re-add the server with an absolute path, or with `$PWD` as above.
- Node older than 20 on the `PATH` Claude Code uses.
- A `readonly = 1` user without `integerJsonEncoding: 'server-default'`. The agent only sees `Error [MCP_EXECUTION_FAILED]: Query execution failed`; stderr shows the cause, `Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode`.
- A slow first start. Outside the project folder, `npx` fetches the package; that took about 15 seconds on our first run. `MCP_TIMEOUT=30000 claude` raises Claude Code's startup timeout to 30 seconds.

## When is the official ClickHouse MCP server a better fit?

Use the official [mcp-clickhouse](https://github.com/ClickHouse/mcp-clickhouse) server when you want Claude to explore any table and write its own SQL. It is a Python server with `run_query`, `list_databases` and `list_tables` tools, and it runs queries with `readonly = 1` unless you set `CLICKHOUSE_ALLOW_WRITE_ACCESS=true`. That suits ad hoc exploration before anyone has defined metrics. hypequery suits the case where answers must match agreed definitions. [ClickHouse MCP servers compared](/blog/clickhouse-mcp-servers-compared) covers the trade-offs.

## Related

- [ClickHouse MCP overview](/clickhouse-mcp)
- [hypequery MCP docs](/docs/mcp/overview)
- [MCP safety model](/docs/mcp/safety)
- [ClickHouse MCP in Cursor](/blog/clickhouse-mcp-cursor)
- [ClickHouse MCP in Codex](/blog/clickhouse-mcp-codex)
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
