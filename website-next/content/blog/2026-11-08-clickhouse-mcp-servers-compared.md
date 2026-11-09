---
title: "Official ClickHouse MCP vs Governed MCP: When Raw SQL Access Is a Problem"
description: "How to connect Claude Code, Claude Desktop, Cursor and other AI agents to ClickHouse over MCP, what the official mcp-clickhouse server, the ClickHouse Cloud remote MCP server and a governed MCP server each expose, and how to lock them down with a read-only user."
seoTitle: "Official ClickHouse MCP vs Governed MCP: Raw SQL or Metrics"
seoDescription: "The official ClickHouse MCP server gives agents a read-only SQL tool; a governed MCP gives them named metrics. When raw SQL access becomes a problem."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-mcp-servers-compared
status: published
tags:
  - ClickHouse
  - MCP
---

To connect Claude, Cursor or another AI agent to ClickHouse, you run an MCP (Model Context Protocol) server that the agent calls as a set of tools. ClickHouse maintains two: the open-source [`mcp-clickhouse`](https://github.com/ClickHouse/mcp-clickhouse) server, which gives the agent a `run_query` SQL tool plus schema discovery and runs queries with `readonly=1` by default, and a managed remote MCP server built into ClickHouse Cloud at `https://mcp.clickhouse.cloud/mcp`, which uses OAuth and only allows `SELECT`. A third kind, governed servers such as `@hypequery/mcp`, exposes predefined datasets and metrics as tools and gives the agent no SQL tool at all.

This guide compares the three, shows the setup for Claude Code, Claude Desktop and Cursor using the snippets from each project's own docs, and shows the ClickHouse user you should create before connecting any of them. Server details below come from the `mcp-clickhouse` README at version 0.7.0, the ClickHouse Cloud docs as of November 2026, and `@hypequery/mcp` 0.11.3. SQL was checked on ClickHouse 26.6.

## What is a ClickHouse MCP server?

A ClickHouse MCP server is a small process that holds a ClickHouse connection and advertises tools (for example "list tables" or "run this query") to an MCP client such as Claude Desktop, Claude Code, Cursor or VS Code. The model never connects to ClickHouse itself. It asks the client to call a tool, the client forwards the call to the server, and the server runs it and returns JSON.

What the server's tools accept decides what the agent can do. A tool that takes a SQL string lets the agent run anything the ClickHouse user is allowed to run. A tool that takes a metric name and a list of dimensions only lets it ask for what you defined. That split is the main difference between the options below.

## Which ClickHouse MCP servers are there?

There are three practical choices, and they differ mainly in where the server runs and whether the agent writes SQL.

| | `mcp-clickhouse` (open source) | ClickHouse Cloud remote MCP | `@hypequery/mcp` (governed) |
| --- | --- | --- | --- |
| Runs | Locally over stdio by default; HTTP or SSE optional | Managed by ClickHouse Cloud, Streamable HTTP | Locally over stdio, or inside your own MCP transport |
| Works with | Any ClickHouse (self-hosted or Cloud), plus embedded chDB | ClickHouse Cloud services (and Cloud Managed Postgres) | Any ClickHouse your query builder can reach |
| Agent sends | SQL (`run_query`) | `SELECT` SQL (`run_select_query`) | Dataset, metric, dimension and filter names as JSON |
| Discovery tools | `list_databases`, `list_tables` | `list_databases`, `list_tables`, plus organization, service, backup, ClickPipes and billing tools | `list_datasets`, `get_dataset_schema` |
| Writes | Off by default; opt in with `CLICKHOUSE_ALLOW_WRITE_ACCESS`, destructive statements also need `CLICKHOUSE_ALLOW_DROP` | All tools are read-only | No SQL tool; tools are annotated read-only |
| Auth to ClickHouse | A ClickHouse user in environment variables | OAuth 2.0 with your Cloud login, or a Cloud API key | A ClickHouse user held in the server process |
| Agent can see | Everything that ClickHouse user can read | The organizations and services your Cloud user can access | Only the datasets you publish |

Sources: the [`mcp-clickhouse` README](https://github.com/ClickHouse/mcp-clickhouse), [Remote MCP in Cloud](https://clickhouse.com/docs/products/cloud/features/ai-ml/remote-mcp), and the [`@hypequery/mcp` tools reference](/docs/mcp/overview).

One naming note: the current `mcp-clickhouse` README calls its query tool `run_query`. Its first release called it `run_select_query`, and some ClickHouse docs pages still use that name. The ClickHouse docs say the tool names "may vary by version".

## When is raw SQL access a problem?

A read-only SQL tool is the right default when the person using the agent already has, and should have, read access to everything the ClickHouse user can see: an engineer exploring their own data, for example. It becomes a problem in four situations, and none of them is solved by `readonly = 1`, which stops writes and DDL but lets the user read every table it has `SELECT` on.

### The agent serves more than one customer or team

With a SQL tool, keeping one tenant's question away from another tenant's rows depends on the agent writing the right `WHERE` clause. A prompt is not an access control. Either give the MCP server a ClickHouse user whose grants and row policies already restrict it to one tenant (shown [below](#how-do-i-create-a-read-only-clickhouse-user-for-an-mcp-server)), or use a server where the tenant is fixed when the server starts and is not an argument the model can change.

### The numbers have to match your product

"Revenue" or "active users" usually has one agreed definition in your backend and dashboards. An agent writing its own SQL will pick its own filters and joins, so its answer can differ from the number on the dashboard. Exposing the metric by name means the agent runs the same definition.

### Some columns should never leave the database

If a table holds emails, addresses or free-text notes, a SQL tool can select them unless the ClickHouse grants exclude those columns. A governed server only exposes the dimensions and measures you list.

### Queries can be expensive

A model can write a full scan over billions of rows. Settings such as `max_execution_time`, `max_result_rows` and `max_bytes_to_read` in the MCP user's profile cap the damage (see [settings for application backends](/blog/clickhouse-settings-for-application-backends)). A governed server also caps result sizes per dataset.

If none of these applies, the official server is simpler: point it at a read-only user and you're done.

## What does the official ClickHouse MCP server (mcp-clickhouse) expose?

`mcp-clickhouse` exposes three ClickHouse tools: `run_query` executes SQL, `list_databases` lists databases, and `list_tables` lists the tables in one database with their columns, paginated at 50 tables per page by default. With the optional `chdb` extra it adds `run_chdb_select_query`, which runs SQL in embedded chDB against files, URLs and other sources.

The README documents these safety behaviours:

- Queries run with `readonly=1` unless `CLICKHOUSE_ALLOW_WRITE_ACCESS=true` is set.
- With writes enabled, `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `REPLACE` and similar statements also need `CLICKHOUSE_ALLOW_DROP=true`. The README calls this check "a best-effort guard against accidents" in the MCP server and says the real security boundary is the ClickHouse user's grants.
- Query calls time out after 30 seconds by default (`CLICKHOUSE_MCP_QUERY_TIMEOUT`), and the server tries to cancel a timed-out query with `KILL QUERY`.
- `run_query` accepts a `params` object for ClickHouse `{name:Type}` placeholders, so values can be passed separately from the SQL text.
- Over HTTP or SSE, the server refuses to start unless you configure a static bearer token, an OAuth provider through FastMCP, or explicitly disable auth for local development.

The README also warns against connecting with the `default` user or any administrative user, and recommends a dedicated user even in read-only mode.

## How do I set up the ClickHouse MCP server in Claude Code?

In Claude Code, add `mcp-clickhouse` as a stdio server with `claude mcp add`. This command is from the [ClickHouse MCP setup guide](https://clickhouse.com/docs/guides/use-cases/ai-ml/MCP/claude-desktop) and needs [`uv`](https://docs.astral.sh/uv/) installed:

```bash
claude mcp add \
  --transport stdio \
  --env CLICKHOUSE_HOST=your-clickhouse-host \
  --env CLICKHOUSE_USER=your-clickhouse-user \
  --env CLICKHOUSE_PASSWORD=your-clickhouse-password \
  --scope user \
  mcp-clickhouse -- \
  uv run --with mcp-clickhouse --python 3.10 mcp-clickhouse
```

Run `claude mcp list`, or `/mcp` inside Claude Code, to check that the server connected. The server uses HTTPS on port 8443 by default. For a self-managed server on plain HTTP, add `--env CLICKHOUSE_SECURE=false` and, if needed, `--env CLICKHOUSE_PORT=8123`. The port must be ClickHouse's HTTP interface: the README notes that the native protocol ports 9000 and 9440 will not work. The docs use `--python 3.10`; the README recommends 3.12 and supports 3.10 through 3.15.

## How do I connect Claude Desktop or Cursor to ClickHouse?

Claude Desktop reads MCP servers from `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%/Claude/` on Windows). This entry is from the `mcp-clickhouse` README:

```json
{
  "mcpServers": {
    "mcp-clickhouse": {
      "command": "uv",
      "args": [
        "run",
        "--with",
        "mcp-clickhouse",
        "--python",
        "3.12",
        "mcp-clickhouse"
      ],
      "env": {
        "CLICKHOUSE_HOST": "<clickhouse-host>",
        "CLICKHOUSE_PORT": "<clickhouse-port>",
        "CLICKHOUSE_USER": "<clickhouse-user>",
        "CLICKHOUSE_PASSWORD": "<clickhouse-password>",
        "CLICKHOUSE_ROLE": "<clickhouse-role>",
        "CLICKHOUSE_SECURE": "true",
        "CLICKHOUSE_VERIFY": "true",
        "CLICKHOUSE_CONNECT_TIMEOUT": "30"
      }
    }
  }
}
```

Replace `uv` with its absolute path (`which uv`), because desktop apps often start without your shell's `PATH`, then restart Claude Desktop. Cursor takes the same `mcpServers` block in `.cursor/mcp.json` for one project or in its global MCP config, according to the ClickHouse setup guide. To try the server without your own data, the README has a variant that points at the public ClickHouse SQL Playground (`sql-clickhouse.clickhouse.com`, user `demo`, empty password).

## Does ClickHouse Cloud have a remote MCP server?

Yes. ClickHouse Cloud runs a managed MCP server at `https://mcp.clickhouse.cloud/mcp` that you enable per service: open the service, click **Connect**, choose **Connect with MCP** and turn it on. Enabling it requires the `control-plane:service:manage-mcp` console permission. There is nothing to install.

In Claude Code, add it and sign in through OAuth (commands from the [Cloud remote MCP setup guide](https://clickhouse.com/docs/products/cloud/features/ai-ml/mcp/remote-mcp)):

```bash
claude mcp add --transport http clickhouse-cloud https://mcp.clickhouse.cloud/mcp
```

Then start `claude`, run `/mcp`, select `clickhouse-cloud` and authenticate with your ClickHouse Cloud credentials. In the Claude web app, add it under **Customize** > **Connectors** as a custom connector. In Cursor, the guide says to install a ClickHouse server from the Cursor Marketplace and authenticate with OAuth. For headless machines where a browser login is impractical, the guide shows sending a ClickHouse Cloud API key as an HTTP Basic `Authorization` header.

Per the [Remote MCP in Cloud](https://clickhouse.com/docs/products/cloud/features/ai-ml/remote-mcp) reference, every tool is annotated `readOnlyHint: true`, `run_select_query` only permits `SELECT`, and OAuth access is scoped to the organizations and services your Cloud user can reach. Beyond querying, it can list services, backups and ClickPipes and return organization cost data, which the open-source server cannot. It only works with ClickHouse Cloud. For self-hosted ClickHouse, use `mcp-clickhouse`.

## How is a governed MCP server like @hypequery/mcp different?

A governed MCP server exposes the analytics you defined in code as typed tools, so the agent asks for "revenue by region" by name and never writes SQL. `@hypequery/mcp` turns datasets defined with `@hypequery/datasets` into four tools: `list_datasets`, `get_dataset_schema`, `query_metric` and `query_dataset`. The tool input schemas are generated from your definitions, so an unknown field or filter operator is rejected before anything reaches ClickHouse.

A dataset maps a table to dimensions and measures, and named metrics sit on top:

```typescript
// analytics/datasets.ts
import { dataset, dimension, measure } from "@hypequery/datasets"

export const Orders = dataset("orders", {
  source: "orders",
  timeKey: "created_at",
  dimensions: {
    region: dimension.string({ label: "Region" }),
    status: dimension.string({ label: "Order status" }),
    createdAt: dimension.timestamp({ column: "created_at", label: "Created at" }),
  },
  measures: {
    revenue: measure.sum("amount", { label: "Revenue", description: "Sum of order amounts." }),
    orderCount: measure.count("id", { label: "Orders" }),
  },
})

export const revenue = Orders.metric("revenue", { measure: "revenue", label: "Revenue" })
```

The MCP config exports the published registry and a dataset client. Anything left out of `datasets` cannot be listed, inspected or queried:

```typescript
// mcp-config.ts (compile to JS before pointing the server at it)
import { createQueryBuilder } from "@hypequery/clickhouse"
import { createDatasetClient, publishDatasets } from "@hypequery/datasets"
import { Orders, revenue } from "./analytics/datasets.js"

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

export const datasets = publishDatasets().publish(Orders, { metrics: { revenue } }).build()
export const analytics = createDatasetClient({ queryBuilder: db })
```

The Claude Desktop entry, from the [MCP clients docs](/docs/mcp/overview), with the placeholder user changed to a dedicated one. Cursor accepts the same `command`, `args` and `env`, and in Claude Code you pass the same command after `--` in `claude mcp add`, as in the `mcp-clickhouse` example above:

```json
{
  "mcpServers": {
    "hypequery": {
      "command": "npx",
      "args": ["-y", "@hypequery/mcp", "--config", "/absolute/path/to/dist/mcp-config.js"],
      "env": {
        "CLICKHOUSE_URL": "https://example.clickhouse.cloud:8443",
        "CLICKHOUSE_USERNAME": "mcp_agent",
        "CLICKHOUSE_PASSWORD": "change-me",
        "CLICKHOUSE_DATABASE": "analytics"
      }
    }
  }
}
```

Asked "what was revenue by region last month?", the agent sends a call like this:

```json
{
  "name": "query_metric",
  "arguments": {
    "dataset": "orders",
    "metric": "revenue",
    "dimensions": ["region"],
    "filters": [
      { "field": "createdAt", "operator": "gte", "value": "2026-10-01" },
      { "field": "createdAt", "operator": "lt", "value": "2026-11-01" }
    ],
    "limit": 10
  }
}
```

Per the [MCP docs](/docs/mcp/overview), every query gets a server-side limit even when the agent omits one (100 rows by default, offsets capped at 10,000), plus a 30-second deadline and a 1 MiB response budget by default. Generated SQL and database error details are left out of tool responses unless you enable `includeSql` for debugging. For tenant-scoped datasets the tenant comes from trusted configuration, and the tool schemas have no tenant argument. The standalone `hypequery-mcp --config` command shown above has no tenant option, so for tenant-scoped datasets either serve your Serve API's datasets with `npx hypequery mcp --tenant acme`, or start the server from your own process with `createMCPServer({ datasets, analytics, tenantId: 'acme' })` ([programmatic setup](/docs/mcp/programmatic)). The trade-off is the obvious one: the agent can only answer questions you modelled. The [ClickHouse MCP page](/clickhouse-mcp) and the [MCP client setup guides](/docs/mcp/clients) cover this server in more depth.

## What is the difference between giving an AI agent a raw connection string and connecting through MCP?

With a raw connection string, the agent (or the code it writes) holds the ClickHouse credential and can use it from any client, for any statement the user's grants allow, and can copy it into files, logs or other tools. Through MCP, the credential stays inside the server process and the agent can only call the tools that server advertises, with whatever limits the server applies.

What that buys depends on the server. With `mcp-clickhouse`, the agent still writes arbitrary SQL, but the server adds `readonly=1`, a query timeout and a destructive-statement check, and MCP clients can ask you to approve tool calls (the ClickHouse setup guide says to review each request). With a governed server, the agent cannot express a query outside the published datasets. Neither replaces the database user: the `mcp-clickhouse` README says plainly that the grants are the security boundary, and a governed server still runs its queries as some ClickHouse user. So the next step is the same for every option.

## How do I create a read-only ClickHouse user for an MCP server?

Create a dedicated user with `readonly = 1` and grant it `SELECT` on only the database the agent needs. This ran on ClickHouse 26.6:

```sql
CREATE USER mcp_reader IDENTIFIED BY 'change-me' SETTINGS readonly = 1;
GRANT SELECT ON analytics.* TO mcp_reader;
SHOW CREATE USER mcp_reader;
SHOW GRANTS FOR mcp_reader;
```

```text
CREATE USER mcp_reader IDENTIFIED WITH sha256_password SETTINGS readonly = 1
GRANT SELECT ON analytics.* TO mcp_reader
```

You can check what `readonly = 1` blocks in any session. Reads work, and writes, DDL and setting changes fail:

```sql
CREATE TABLE events (id UInt64, created_at DateTime) ENGINE = MergeTree ORDER BY id;
INSERT INTO events VALUES (1, now());
SET readonly = 1;
SELECT count() FROM events;
INSERT INTO events VALUES (2, now());
```

```text
1
Code: 164. DB::Exception: default: Cannot execute query in readonly mode. (READONLY)
```

`DROP TABLE`, `CREATE TABLE`, `ALTER TABLE ... DELETE` and `SET readonly = 0` fail with the same code 164 after `SET readonly = 1`. So does a per-query setting such as `SETTINGS max_threads = 1`: at `readonly = 1` a query can only pass a setting whose value matches what is already set.

That last rule matters for clients that send their own settings. `readonly = 2` blocks the same writes and DDL but lets the session change settings other than `readonly`. If a server needs that, use `readonly = 2` with constraints on a settings profile so the agent cannot raise the limits:

```sql
CREATE DATABASE analytics;
CREATE SETTINGS PROFILE mcp_agent_profile SETTINGS
  readonly = 2,
  max_execution_time = 30 MAX 30,
  max_result_rows = 10000 MAX 10000,
  result_overflow_mode = 'throw';
CREATE USER mcp_agent IDENTIFIED BY 'change-me' SETTINGS PROFILE 'mcp_agent_profile';
GRANT SELECT ON analytics.* TO mcp_agent;
```

With that profile applied, `SET max_execution_time = 60` fails with `Setting max_execution_time shouldn't be greater than 30. (SETTING_CONSTRAINT_VIOLATION)`, and a `SELECT` returning 20,000 rows fails with `Limit for result exceeded, max rows: 10.00 thousand` (code 396). Two things the [query permissions docs](https://clickhouse.com/docs/concepts/features/configuration/settings/permissions-for-queries) point out: `readonly = 2` also allows `CREATE TEMPORARY TABLE` and `RESTORE`, and `BACKUP` is not restricted by `readonly` at any level, so keep grants narrow as well.

Which level to pick depends on the server. `mcp-clickhouse` applies `readonly=1` itself, so a `readonly = 1` user matches it. `@hypequery/clickhouse` sends `output_format_json_quote_64bit_integers = 1` on every query so 64-bit integers arrive as exact strings; at `readonly = 1` that fails with `Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode` unless the user's profile already sets it to 1. The [read-only users reference](/docs/reference/readonly-users) recommends `readonly = 2` with constraints for that reason.

If several customers' rows share a table and an agent must be able to run SQL against it, add a row policy per user. On ClickHouse 26.6, with `CREATE ROW POLICY acme_only ON orders USING tenant_id = 'acme' TO default`, a `GROUP BY tenant_id` over a table holding `acme` and `globex` rows returned only `acme	15`. See [CREATE ROW POLICY](https://clickhouse.com/docs/reference/statements/create/row-policy).

## Which ClickHouse MCP server should you choose?

Use `mcp-clickhouse` or the Cloud remote MCP server when the person talking to the agent owns the data and wants to explore it. Ad hoc questions, schema discovery, debugging a slow query with `EXPLAIN ESTIMATE` and drafting SQL all need the agent to write arbitrary SQL, and a governed server cannot do them. Pick the Cloud server if you are on ClickHouse Cloud and want OAuth with nothing to run, or if you want the service, backup, ClickPipes and billing tools. Pick `mcp-clickhouse` for self-hosted ClickHouse, for chDB, or when you need to run the MCP server inside your own network. Either way, connect it as a `readonly = 1` user with grants limited to the databases in scope.

Use a governed server when the agent answers questions for people who should not have SQL access: customers inside your product, or a company-wide assistant where "revenue" has to mean the same thing as it does on the finance dashboard. A raw SQL tool there means every table the user can read is reachable, the agent decides how each metric is calculated, and tenant scope depends on row policies or on the model writing the right `WHERE` clause. With published datasets, the definitions, row limits and tenant are fixed by the server, at the cost of modelling the data first.

Many teams run both: a raw SQL server for engineers working on their own data, and a governed one for everyone else.

## Related

- [ClickHouse MCP server for governed AI analytics](/clickhouse-mcp)
- [hypequery MCP docs](/docs/mcp/overview)
- [Read-only ClickHouse users](/docs/reference/readonly-users)
- [ClickHouse semantic layer](/clickhouse-semantic-layer)
- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics)
- ClickHouse docs: [mcp-clickhouse on GitHub](https://github.com/ClickHouse/mcp-clickhouse), [Set up the ClickHouse MCP server](https://clickhouse.com/docs/guides/use-cases/ai-ml/MCP/claude-desktop), [Remote MCP in Cloud](https://clickhouse.com/docs/products/cloud/features/ai-ml/remote-mcp), [Enable the Cloud remote MCP server](https://clickhouse.com/docs/products/cloud/features/ai-ml/mcp/remote-mcp), [Permissions for queries](https://clickhouse.com/docs/concepts/features/configuration/settings/permissions-for-queries), [Constraints on settings](https://clickhouse.com/docs/concepts/features/configuration/settings/constraints-on-settings), [CREATE USER](https://clickhouse.com/docs/reference/statements/create/user)
