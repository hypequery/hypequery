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
- `--style <style>`: `queries` (default) or `datasets`
- `--auth <mode>`: `none` (default) or `context`
- `--all-tables`: with `--style datasets`, scaffold every table
- `--tables <names>`: with `--style datasets`, scaffold these comma-separated tables
- `--exclude-tables <names>`: with `--style datasets`, exclude these comma-separated tables
- `--no-example`: skip the example query
- `--no-interactive`: read connection details from env vars
- `--force`: overwrite existing scaffold files
- `--skip-connection`: skip testing the ClickHouse connection before scaffolding

Set `HYPEQUERY_SKIP_INSTALL=1` to skip the automatic dependency install.

### `hypequery dev`

Runs the local serve runtime with docs and hot reload.

```bash
npx hypequery dev
```

Options:

- `--port <port>`: default `4000`
- `--hostname <host>`: default `localhost`
- `--path <path>`: analytics directory to load (`<path>/api.ts` or `<path>/queries.ts`)
- `--no-watch`: disable file watching
- `--open`: open the browser automatically
- `--quiet`: reduce startup output

The CLI understands TypeScript entry files directly, so `analytics/queries.ts` works without an extra runner.

### `hypequery generate`

Regenerates schema types from ClickHouse.

```bash
npx hypequery generate
```

Options:

- `--output <path>`: default `analytics/schema.ts`
- `--path <path>`: analytics directory (derives `<path>/schema.ts`)
- `--tables <names>`: comma-separated table list
- `--database <type>`: currently `clickhouse`

`hypequery generate:types` is an alias for `hypequery generate`.

### `hypequery generate:datasets`

Generates dataset (semantic layer) definitions from ClickHouse.

```bash
npx hypequery generate:datasets
```

Options:

- `--output <path>`: default `src/datasets/generated.ts`
- `--path <path>`: analytics directory (derives `<path>/datasets.ts`)
- `--tables <names>`: comma-separated table list
- `--exclude-tables <names>`: comma-separated tables to exclude

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
