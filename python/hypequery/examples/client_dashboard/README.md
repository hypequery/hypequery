# One Python definition, React and MCP

Run a real ClickHouse API, generate frontend types from its logical definitions,
and expose the same endpoints to MCP. Requirements: Python 3.11+, Node 20+
(22 recommended), pnpm, uv, and a ClickHouse instance. Python backend use does
not require Node; frontend tooling and the MCP bridge do.

The published npm packages support this journey: `@hypequery/cli` 1.25+,
`@hypequery/react` 0.7+ and `@hypequery/mcp` 0.10+. The MCP bridge
(`hypequery mcp --client-contract-url`) needs `@hypequery/mcp` installed next to
`@hypequery/cli`. The preparation script below builds everything from this
checkout instead, so it also covers unreleased changes.

## Prepare

From the repository root after `pnpm install --frozen-lockfile`:

```bash
bash scripts/prepare-python-client-tutorial.sh
```

Retain the printed directory and set `TUTORIAL` to that absolute path in each
terminal below. The script builds/packs Node packages and a Python wheel, creates
a virtual environment, copies these files, exports `contract.json`, generates
`client.generated.ts`, checks generation drift and strictly compiles/bundles
React. It does not start servers, publish packages or touch ClickHouse.

`python -m hypequery` selects the Python CLI; `npx --no-install hypequery` from
the frontend directory selects the installed Node CLI. Their jobs differ.

## Seed and serve Python

Use a dedicated tutorial database and your usual ClickHouse SQL client to run
`$TUTORIAL/backend/examples/client_dashboard/seed.sql`. The idempotent seed gives
A three country groups totaling 60, and B two totaling 1000. One A country is null.
Amounts are decimals and travel as strings.

Set your connection environment (the port is the HTTP port) and two distinct
local user credentials. Retain them in your local environment:

```bash
export CLICKHOUSE_HOST=127.0.0.1
export CLICKHOUSE_PORT=8123
export CLICKHOUSE_DATABASE=your_tutorial_database
export CLICKHOUSE_USERNAME=your_readonly_user
# Set CLICKHOUSE_PASSWORD through your secret manager/shell.
export HYPEQUERY_TENANT_A_TOKEN="$(openssl rand -hex 24)"
export HYPEQUERY_TENANT_B_TOKEN="$(openssl rand -hex 24)"
cd "$TUTORIAL/backend"
../.venv/bin/python -m examples.client_dashboard
```

The API listens on `127.0.0.1:8000`. Authentication maps tokens to principals,
tenants and the `analytics:read` scope. Query bodies cannot choose a tenant.
The example owns executor shutdown, caps results at 100 rows plus a pagination
probe/1 MiB/10 seconds, disables development docs and allows CORS only from
`http://127.0.0.1:5173`.

`definitions.py` has no framework, credential or driver imports. `api.py` installs:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/orders` | Dataset with revenue/orderCount measures |
| `POST /v1/sales` | Fixed revenue metric, output alias `sales` |
| `GET /v1/client-contract` | Authenticated, current authorized discovery |

In a second terminal with the same A credential:

```bash
curl --fail-with-body http://127.0.0.1:8000/v1/sales \
  -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

The response contains a string-valued `sales` totaling 60. Request metadata with
`includeMeta: true`: it contains pagination and `cache.hit`, never SQL, parameters
or tenant context. Backend authorization runs on every call.

## Generate and run React

Preparation already generated the client. Following a definition change, stop
the API, edit the copied definitions and run:

```bash
cd "$TUTORIAL/backend"
../.venv/bin/python -m hypequery export client-contract \
  --factory examples.client_dashboard.definitions:build \
  --output examples/client_dashboard/frontend/contract.json --force
cd examples/client_dashboard/frontend
npm run generate
npm run check:generated
npm run build
npm run dev
```

Restart the API and open `http://127.0.0.1:5173`. Enter A's user token in the
password field, then inspect results and page through both dataset and metric
results. Connect with B's token: B must show 1000 with no A data. Each login
creates a new client and QueryClient and clears old cache data. Tokens stay in
memory, outside source/generated files, browser storage and URLs. Never give a
browser database or backend service credentials. Production apps resolve
short-lived user credentials through their login flow.

`app.tsx` uses generated `ClientApi`/`clientManifest` with all four hook families:
dataset, metric, infinite dataset and infinite metric. It has no handwritten
field unions/routes or duplicated business formulas. Aggregate values remain
strings; avoid `Number(...)` for exact decimal arithmetic. Country may be null.

The build export describes capabilities; it does not grant permission. Requests
carry endpoint schema pins while Python reauthorizes them. A schema change returns
409. Regenerate, review, rebuild and deploy matching changes; do not remove the
pin or automatically retry with a new schema. `check:generated` detects drift
between the JSON export and generated file; re-export definitions first in CI.

## Connect MCP to the same API

From the prepared frontend directory, select one backend principal through the
environment, keeping credentials out of arguments:

```bash
export HYPEQUERY_API_KEY="$HYPEQUERY_TENANT_A_TOKEN"
npx --no-install hypequery mcp \
  --client-contract-url http://127.0.0.1:8000/v1/client-contract --self-test
```

With both tutorial token variables available, `npm run check:mcp` launches two
actual SDK stdio clients and checks tenant-specific metrics, nullable pagination,
refused SQL/context overrides and child-process shutdown against this API.

The self-test checks discovery/tools and runs no query. Configure your MCP client
to launch the installed CLI directly. Replace the absolute path below with your
prepared directory. Configure `HYPEQUERY_API_KEY` separately in the client's
secret/environment settings:

```json
{
  "mcpServers": {
    "python-orders": {
      "command": "node",
      "args": [
        "/absolute/tutorial/backend/examples/client_dashboard/frontend/node_modules/@hypequery/cli/dist/bin/cli.js",
        "mcp", "--client-contract-url",
        "http://127.0.0.1:8000/v1/client-contract"
      ]
    }
  }
}
```

Ask it to list datasets, inspect `orders`, query revenue by country and query
metric `sales` for dataset `orders`. For pagination request `includeMeta: true`
and follow `pagination.hasMore` with `offset + limit`. Arguments cannot select
SQL, tenant, credential or another URL. Python executes the same definitions
used by React. One MCP process represents one principal; restart after changing
principal or after a stale-contract error. There is no automatic schema replacement
or replay. HTTPS is required outside loopback and redirects are refused. Existing
`--url` names a hosted MCP endpoint and has a different purpose.

## Deployment and release checks

Replace the local token table with your principal resolver. Configure trusted
hosts, exact CORS origins, read-only ClickHouse access, explicit process/query
limits and executor shutdown. When mounting under another prefix, update build
paths and the installed host's trusted mount configuration together. Set the
browser API origin for your deployment and include deployment/schema/principal
in cache scope. Rotating a token alone does not isolate cached data.

The live example test uses a fresh ClickHouse database and checks both principals,
nullable decimal grouping, paging termination, pins and refused context/SQL inputs
on the existing Python integration matrix. The preparation script qualifies
installed export/codegen/type/bundle wiring. Separate browser and MCP smoke
journeys also use installed artifacts. The combined browser/MCP/ClickHouse
candidate-SHA gate, database cancellation checks and exact published-version
qualification remain release requirements.
