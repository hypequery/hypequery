# @hypequery/mcp — Manual Testing Spec

A self-contained test plan for `@hypequery/mcp`, written so it can be handed to an
agent/model and executed end-to-end. It builds **one real, inspectable app** under
`hq-mcp-test/`: an MCP config + dataset registry, plus a small stdio **driver script**
that calls every tool and writes each response to `out/` for inspection.

- **Package under test:** `@hypequery/mcp` (`v0.1.0`, bin `hypequery-mcp`)
- **Companions:** `@hypequery/datasets`, `@hypequery/clickhouse`
- **Docs covered:** `mcp/overview`, `mcp/configuration`, `mcp/tools`, `mcp/programmatic`, `mcp/clients`, `mcp/safety`
- **Public API (verified):** CLI `hypequery-mcp --config <path>`; programmatic `createMCPServer({ datasets, analytics, name?, version?, tenantId? })`, `HypequeryMCPServer`; tools `list_datasets`, `get_dataset_schema`, `query_metric`, `query_dataset`; prompt `dataset_guide`; constants `MAX_QUERY_LIMIT`, `DEFAULT_QUERY_LIMIT`.

> Transport is **stdio**: the server speaks MCP protocol on stdout and routes
> `console.log/info/debug` to **stderr** so logs don't corrupt the stream. The driver
> script connects over stdio exactly as Claude Desktop / Cursor would.

---

## 0. Prerequisites & app skeleton

### 0.1 Tooling
- Node ≥ 18, `tsx`.
- ClickHouse seeded with the **shared `ds_test` database** from **`datasets-testing-spec.md` §0.4** (the inline `Orders` dataset below targets `ds_test.orders`). Set `CLICKHOUSE_DATABASE=ds_test`.
- MCP client SDK for the driver: `@modelcontextprotocol/sdk` (provides `Client` + `StdioClientTransport`). Alternatively drive with `npx @modelcontextprotocol/inspector` for manual/visual inspection.

### 0.2 Create the app
```bash
mkdir hq-mcp-test && cd hq-mcp-test
npm init -y && npm pkg set type=module
npm install @hypequery/mcp @hypequery/datasets @hypequery/clickhouse
npm install -D @modelcontextprotocol/sdk tsx typescript @types/node
# .env / exported CLICKHOUSE_* with CLICKHOUSE_DATABASE=ds_test (datasets spec §0.4)
```

### 0.3 Inspectable files
```
hq-mcp-test/
  datasets/
    orders.ts            # NON-tenant Orders (for CLI happy path) + metrics
    orders-tenant.ts     # tenant-keyed Orders (for tenant tests)
  mcp-config.mjs         # exports { datasets, analytics }  (no tenantKey datasets)
  mcp-config-tenant.mjs  # exports a tenant-keyed registry (CLI must reject this)
  programmatic.ts        # createMCPServer({ ..., tenantId }) for tenant-scoped run
  driver.ts              # stdio MCP client: calls every tool, writes out/*.json
  out/                   # tool responses (inspect these)
```

### 0.4 `mcp-config.mjs` (CLI happy path — no tenantKey)
```javascript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, dataset, dimension, measure, divide, nullIfZero } from '@hypequery/datasets';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER ?? process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',                       // NOTE: no tenantKey for CLI use
  dimensions: {
    id: dimension.number(),
    status: dimension.string({ label: 'Order Status', description: 'Lifecycle state.' }),
    country: dimension.string({ label: 'Country' }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue', description: 'Total order revenue.' }),
    orderCount: measure.count('id'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue', label: 'Revenue', description: 'Total order revenue.' });
const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });
const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
  label: 'Average Order Value',
});

export const datasets = {
  orders: { ...Orders, metrics: { revenue, orderCount, averageOrderValue } },
};
export const analytics = createDatasetClient({ queryBuilder: db });
```

### 0.5 `driver.ts` (stdio MCP client)
Connects with `StdioClientTransport({ command: 'npx', args: ['hypequery-mcp','--config','./mcp-config.mjs'], env: process.env })`, then:
- `await client.listTools()` → assert tool set
- `await client.callTool({ name, arguments })` for each scenario
- `await client.listPrompts()` / `getPrompt('dataset_guide')`
- write every response to `out/<scenario>.json`, then `client.close()`.

---

## 1. CLI startup & config contract (`configuration.mdx`, `bin.ts`)

### M1.1 — `--config` is required
`npx hypequery-mcp` (no flag) → exits 1 with `Error: --config flag is required` + usage text. **Pass:** nonzero exit, message on stderr.

### M1.2 — Missing exports
A config missing `datasets` → error `Config file must export "datasets"`. Missing `analytics` → `Config file must export "analytics"`. Exit 1.

### M1.3 — Bad config path
`--config ./nope.mjs` → import error, exit 1, message on stderr.

### M1.4 — Happy startup
`npx hypequery-mcp --config ./mcp-config.mjs` → process stays alive; startup logs on **stderr** (not stdout). SIGINT → `Shutting down MCP server...`, exit 0.

### M1.5 — stdout cleanliness
Confirm nothing the config logs (`console.log`) leaks to stdout — only MCP protocol frames. (The driver's handshake succeeding is the proof; also eyeball stdout is JSON-RPC only.)

### M1.6 — Bin aliases
Both `npx hypequery-mcp --config ...` and `npx @hypequery/mcp --config ...` start the same server (single bin).

---

## 2. Tool discovery

### M2.1 — `listTools`
Driver asserts exactly: `list_datasets`, `get_dataset_schema`, `query_metric`, `query_dataset`. **No `run_sql`/raw-SQL tool exists** (safety boundary).

### M2.2 — `listPrompts`
Includes `dataset_guide`. `getPrompt('dataset_guide')` returns guidance text. Save to `out/prompt-dataset_guide.json`.

---

## 3. `list_datasets`

### M3.1 — Lists registry
`callTool({ name:'list_datasets' })` → `{ datasets:[{ name:'orders', description, dimensionCount, metricCount }], total:1 }`. **Pass:** `metricCount` reflects the 3 attached metrics; `dimensionCount` = 4.

### M3.2 — Registry boundary
Remove `orders` from the registry → `list_datasets` returns `total:0`. (A dataset not in the export cannot be listed/queried.)

---

## 4. `get_dataset_schema`

### M4.1 — Schema for a dataset
`callTool({ name:'get_dataset_schema', arguments:{ dataset:'orders' } })` → dimensions (with labels/descriptions), named metrics, `timeKey`, and `tenantKey`/relationships when present. **Pass:** `status` dimension shows `label:'Order Status'` and its description; metrics include `revenue`, `orderCount`, `averageOrderValue`. Save to `out/schema-orders.json` — these labels/descriptions are the agent-facing metadata.

### M4.2 — Unknown dataset
`dataset:'ghost'` → error response (not a crash). Record message.

---

## 5. `query_metric`

### M5.1 — Named metric
```json
{ "name":"query_metric","arguments":{ "dataset":"orders","metric":"revenue",
  "dimensions":["country"],
  "filters":[{"field":"status","operator":"eq","value":"completed"}],
  "orderBy":[{"field":"revenue","direction":"desc"}],"limit":10 }}
```
**Pass:** rows of `{country, revenue}` returned; ordered desc. Save `out/query_metric-revenue.json`.

### M5.2 — Derived metric
`metric:'averageOrderValue'` with `dimensions:['country']` → returns AOV per country. (Derived/named metrics are only reachable here, **not** via `query_dataset` — see M6.4.)

### M5.3 — Time grain
`metric:'revenue', grain:'month', dimensions:['country']` → monthly buckets on `created_at`.

### M5.4 — Unknown metric
`metric:'nope'` → error response. Record.

---

## 6. `query_dataset`

### M6.1 — Ad hoc rollup
```json
{ "name":"query_dataset","arguments":{ "dataset":"orders",
  "dimensions":["country","status"],"metrics":["revenue","orderCount"],
  "filters":[{"field":"status","operator":"eq","value":"completed"}],"limit":100 }}
```
**Pass:** combined rows; note the arg is `metrics` but maps to dataset **measures**.

### M6.2 — Grain on dataset query
Add `"grain":"month"` → monthly buckets.

### M6.3 — At least one dimension or metric required
`{ dataset:'orders' }` with neither → rejected. Record the error.

### M6.4 — Derived metric NOT allowed as a measure
`metrics:['averageOrderValue']` in `query_dataset` → rejected/empty (it's not a measure). Confirm it only works through `query_metric` (M5.2).

---

## 7. Operators, grains, pagination (`tools.mdx`)

### M7.1 — All operators
Through `query_metric`/`query_dataset` filters, exercise each: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `between`, `like`. Confirm valid ops accepted, an invalid op (e.g. `regex`) rejected.

### M7.2 — All grains
`grain` ∈ `{day, week, month, quarter, year}` accepted; an unsupported grain rejected.

### M7.3 — Pagination
`limit` + `offset` page through results; `offset` skips rows. Compare page 1 (`offset:0`) vs page 2. Cross-check against `MAX_QUERY_LIMIT`/`DEFAULT_QUERY_LIMIT` (a `limit` above max is clamped/handled — record behavior).

---

## 8. Programmatic server & tenancy (`programmatic.mdx`, `safety.mdx`)

### M8.1 — `createMCPServer`
`programmatic.ts`: `const server = await createMCPServer({ datasets, analytics, name:'analytics-mcp', version:'1.0.0' })` starts over stdio and returns the instance. Drive it the same way (spawn `tsx programmatic.ts`). `await server.stop()` shuts it down.

### M8.2 — CLI rejects tenant-keyed datasets
Point the CLI at `mcp-config-tenant.mjs` (registry whose `orders` has `tenantKey:'tenant_id'`). **Pass:** startup **fails** with `MCP server tenantId is required for tenant-scoped datasets`. (The CLI accepts no `tenantId`.)

### M8.3 — Tenant-scoped programmatic server
`createMCPServer({ datasets: tenantRegistry, analytics, tenantId:'t1' })` starts successfully; `query_metric`/`query_dataset` results are scoped to `t1` (tenant predicate injected from the dataset `tenantKey`). A second process with `tenantId:'t2'` sees disjoint rows. Agents cannot pick a tenant via filters.

### M8.4 — Safety: no raw SQL
Re-confirm M2.1 — no `run_sql`; the capability boundary is the exported `datasets` registry + attached metrics.

---

## 9. Client integration smoke (`clients.mdx`) — optional

### M9.1 — Inspector
`npx @modelcontextprotocol/inspector npx hypequery-mcp --config $(pwd)/mcp-config.mjs` → connect, list tools, run `list_datasets`/`get_dataset_schema` from the UI. Screenshot for inspection.

### M9.2 — Claude Desktop / Cursor config
Produce the `claude_desktop_config.json` / Cursor entry from the docs using an **absolute** config path + `CLICKHOUSE_*` env. (Manual: confirm the server appears and tools are callable.) Document that relative paths are the common failure.

---

## 10. Reporting template
Per scenario: tool + arguments, expected vs actual (rows/shape/error), PASS/FAIL, notes. Attach the `out/*.json` responses (schema, query results, prompt) as inspectable artifacts. Confirm/deny Appendix A.

---

## Appendix A — Things to confirm against docs
- **Bin invocation:** docs show both `npx @hypequery/mcp --config` and `npx hypequery-mcp --config`. Confirm both resolve to the single `hypequery-mcp` bin (M1.6).
- **`query_dataset.metrics` naming:** the arg is `metrics` but maps to **measures**; derived/named metrics are rejected here (M6.1, M6.4). Confirm the rejection is graceful, not a crash.
- **Tenant CLI limitation:** confirm the exact startup error string `MCP server tenantId is required for tenant-scoped datasets` when a tenant-keyed dataset is loaded via the CLI (M8.2).
- **`createMCPServer` return/version:** docs say it returns the started instance; the CLI hardcodes `name:'hypequery-mcp-server'`, `version:'0.1.0'`. Note the programmatic `name`/`version` are caller-supplied.
- **stdout purity:** verify config-time `console.log` truly lands on stderr (M1.5) — a regression here breaks every client.
