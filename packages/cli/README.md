# @hypequery/cli

The fastest way to start a type-safe ClickHouse analytics backend in TypeScript.

`@hypequery/cli` connects to ClickHouse or embedded chDB, generates schema types, scaffolds queries or semantic datasets, and runs a local API with interactive documentation. The same CLI can generate React route manifests and deploy a verified analytics bundle when you are ready.

## Start here

```bash
npm install -D @hypequery/cli
npx hypequery init
npx hypequery dev --open
```

`init` checks the database, writes an `analytics/` project, generates types, and installs the packages used by the scaffold.

For a semantic layer:

```bash
npx hypequery init --style datasets
```

For embedded analytics without a ClickHouse server:

```bash
npx hypequery init \
  --database chdb \
  --chdb-path ./analytics.chdb
```

## The commands you will use

| Command | Outcome |
| --- | --- |
| `hypequery init` | A working typed analytics project |
| `hypequery dev` | Local API, docs, and hot reload |
| `hypequery generate` | Fresh TypeScript types from ClickHouse or chDB |
| `hypequery generate:datasets` | Dataset definitions scaffolded from tables |
| `hypequery generate:manifest` | A browser-safe route manifest for React hooks |
| `hypequery login` | An authenticated Cloud target |
| `hypequery deploy` | A verified deployment of the analytics API |
| `hypequery pull` / `diff` | Live source inspection and comparison |

Non-interactive ClickHouse commands read `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`.

## Why use the CLI

- Get correct ClickHouse runtime types instead of guessing interfaces.
- Move from one local query to datasets, APIs, React, and MCP without changing tools.
- Keep generated types and route manifests reproducible in CI.
- Build closed, hash-verified deployment artifacts from the same source.

## Learn more

- [Quick start](https://hypequery.com/docs/quick-start)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)
- [Current capabilities](https://hypequery.com/docs/capabilities)

## License

Apache-2.0.
