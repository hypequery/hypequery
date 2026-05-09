# @hypequery/cli

CLI for scaffolding and running the main hypequery path.

Use it to:

- generate schema types from ClickHouse
- scaffold `analytics/` files
- run the local dev server with docs

## Quick Start

Run it directly:

```bash
npx @hypequery/cli init
npx @hypequery/cli dev
npx @hypequery/cli generate
```

Or install it once:

```bash
npm install -D @hypequery/cli
```

## Commands

### `hypequery init`

Scaffolds the standard hypequery setup.

```bash
npx hypequery init
```

It will:

- generate schema types
- create client and query files
- write `.env` values
- update `.gitignore`
- install scaffold dependencies, including `zod`

Options:

- `--path <path>`: output directory, default `analytics/`
- `--no-example`: skip the example query
- `--no-interactive`: read connection details from env vars
- `--force`: overwrite existing scaffold files
- `--skip-connection`: skip testing the ClickHouse connection before scaffolding

### `hypequery dev`

Runs the local serve runtime with docs and hot reload.

```bash
npx hypequery dev
```

Options:

- `--port <port>`: default `4000`
- `--hostname <host>`: default `localhost`
- `--no-watch`: disable file watching
- `--cache <provider>`: `memory`, `redis`, or `none`
- `--open`: open the browser automatically
- `--cors`: enable CORS
- `--quiet`: reduce startup output

The CLI understands TypeScript entry files directly, so `analytics/queries.ts` works without an extra runner.

### `hypequery generate`

Regenerates schema types from ClickHouse.

```bash
npx hypequery generate
```

Options:

- `--output <path>`: default `analytics/schema.ts`
- `--tables <names>`: comma-separated table list
- `--database <type>`: currently `clickhouse`

## Non-interactive Setup

`hypequery init --no-interactive` reads:

- `CLICKHOUSE_URL` or deprecated `CLICKHOUSE_HOST`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USERNAME` or `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

## Notes

- generated scaffold files use NodeNext-safe local `.js` imports
- `CLICKHOUSE_URL` is now the preferred connection variable
- the CLI bundles the ClickHouse driver for schema generation

## Docs

- [Quick start](https://hypequery.com/docs/quick-start)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)

## License

Apache-2.0.
