# Vite + @hypequery/serve example

This example runs a standalone hypequery Serve instance alongside a Vite React app. During
development, Vite proxies `/api`, `/docs`, and `/openapi.json` to the Node server.

## Commands

```bash
npm install
npm run dev
```

This launches both the API server (`src/server.ts`) via `serveDev` and the Vite dev server. The
React app fetches metrics from `/api/*` and links to the auto-generated docs hosted by serve.

### Optional: connect to ClickHouse

Set the following environment variables before running `npm run dev` to stream real data from
ClickHouse using `@hypequery/clickhouse`:

```
CLICKHOUSE_URL=https://your-clickhouse-host:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=...
CLICKHOUSE_DATABASE=default
```

When these are present the `recentOrders` route will execute a real query; otherwise it serves mock
data so the example still works out of the box.

Use `npm run dev:api` or `npm run dev:web` to run the services individually. The generated docs UI is
available at http://localhost:5173/docs (proxied to the API server), and you can hit the OpenAPI spec
at http://localhost:5173/openapi.json.
