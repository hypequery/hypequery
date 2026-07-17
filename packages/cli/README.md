# @hypequery/cli

CLI for scaffolding and running the main hypequery path.

Use it to:

- generate schema types from ClickHouse or embedded chDB
- scaffold `analytics/` files
- run the local dev server with docs
- build and validate portable deployment contracts

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

- connect to ClickHouse or start an embedded chDB session
- generate schema types when the database is available
- create client and query files
- write `.env` values for ClickHouse connections
- update `.gitignore`, including a project-local persistent chDB directory
- install scaffold dependencies, including `zod` and the selected database adapter

Options:

- `--path <path>`: output directory, default `analytics/`
- `--style <style>`: `queries` (default) or `datasets`
- `--database <type>`: `clickhouse` (default) or `chdb`
- `--chdb-path <path>`: persistent chDB data directory; omit for an in-memory session
- `--auth <mode>`: `none` (default) or `context`
- `--all-tables`: with `--style datasets`, scaffold every table
- `--tables <names>`: with `--style datasets`, scaffold these comma-separated tables
- `--exclude-tables <names>`: with `--style datasets`, exclude these comma-separated tables
- `--no-example`: skip the example query
- `--no-interactive`: skip prompts; ClickHouse connection details come from env vars
- `--force`: overwrite existing scaffold files
- `--skip-connection`: skip testing the selected database before scaffolding

Set `HYPEQUERY_SKIP_INSTALL=1` to skip the automatic dependency install.

To scaffold against persistent embedded chDB without server credentials:

```bash
npx hypequery init --database chdb --chdb-path ./analytics.chdb --no-interactive
```

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

Regenerates schema types from ClickHouse or embedded chDB.

```bash
npx hypequery generate
```

Options:

- `--output <path>`: default `analytics/schema.ts`
- `--path <path>`: analytics directory (derives `<path>/schema.ts`)
- `--tables <names>`: comma-separated table list
- `--database <type>`: `clickhouse` or `chdb`; chDB generation must be selected explicitly
- `--chdb-path <path>`: persistent chDB data directory; omit for an in-memory session

For a persistent chDB scaffold, pass the same path used by `init`:

```bash
npx hypequery generate --database chdb --chdb-path ./analytics.chdb
```

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

### `hypequery generate:manifest`

Generates a static React hook route manifest from an exported HypeQuery API.

```bash
npx hypequery generate:manifest analytics/api.ts --output analytics/hypequery-manifest.json
```

The output is the exact serializable JSON returned by `api.manifest()`, including
semantic keys such as `dataset:orders`.

### `hypequery deployment:build`

Builds deployment metadata for an exported HypeQuery API and writes the
artifact with its identity sidecar.

```bash
npx hypequery deployment:build analytics/api.ts \
  --runtime-artifact 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The runtime artifact digest is required when named Serve handlers cannot be
lowered to a portable implementation. Dataset-only APIs can omit it.

Options:

- `--output <path>`: default `analytics/hypequery-deployment.json`
- `--runtime <runtime>`: `node` (default) or `python`
- `--runtime-artifact <sha256>`: lowercase SHA-256 of the built runtime artifact
- `--entrypoint-prefix <prefix>`: default `queries`
- `--hash-output <path>`: default `<output>.sha256`

The identity sidecar is not compatible with `sha256sum -c`. Use
`deployment:validate` to validate the artifact and report its identity.

### `hypequery deployment:validate`

Validates an existing deployment artifact and reports its datasets, queries,
runtime artifacts, and identity.

```bash
npx hypequery deployment:validate analytics/hypequery-deployment.json
```

## Non-interactive Setup

For ClickHouse, `hypequery init --no-interactive` reads:

- `CLICKHOUSE_URL` or deprecated `CLICKHOUSE_HOST`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USERNAME` or `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

## Notes

- generated scaffold files use NodeNext-safe local `.js` imports
- `CLICKHOUSE_URL` is now the preferred connection variable
- the CLI bundles the ClickHouse driver for schema generation
- chDB runs in memory unless `--chdb-path` is provided; persistent paths must be reused by later `generate` commands

## Docs

- [Quick start](https://hypequery.com/docs/quick-start)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)

## License

Apache-2.0.
