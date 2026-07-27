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

Builds a closed deployment bundle for an exported HypeQuery API. The bundle
contains canonical deployment metadata, every referenced runtime artifact, and
a manifest that binds their exact bytes and identities.

```bash
npx hypequery deployment:build analytics/api.ts
```

The default output is `analytics/hypequery-deployment/`. Named Serve handlers
are bundled into a Node runtime artifact automatically. Dataset-only APIs do
not produce a runtime artifact. For a separately built Node or Python runtime,
provide both its expected digest and file path:

```bash
npx hypequery deployment:build analytics/api.ts \
  --runtime python \
  --runtime-artifact <sha256> \
  --runtime-file dist/runtime.pyz
```

Options:

- `--bundle-output <directory>`: default `analytics/hypequery-deployment`
- `--runtime <runtime>`: `node` (default) or `python`
- `--runtime-artifact <sha256>`: lowercase SHA-256 of a prebuilt runtime artifact
- `--runtime-file <path>`: bytes for the prebuilt runtime artifact
- `--entrypoint-prefix <prefix>`: default `queries`

The compatibility options `--output`, `--runtime-output`, and `--hash-output`
still emit the earlier metadata files instead of a complete bundle. They cannot
be combined with `--bundle-output`.

### `hypequery deployment:validate`

Verifies a complete deployment bundle before returning any contained metadata.
Verification rejects missing or undeclared files, symbolic links, path
traversal, byte-length or hash mismatches, deployment identity mismatches, and
runtime files not referenced by the deployment. Legacy deployment JSON files
are still accepted for metadata-only validation.

```bash
npx hypequery deployment:validate analytics/hypequery-deployment
```

### `hypequery login`

Authorizes the local CLI through your existing Hypequery Cloud browser
session. The command uses an S256 PKCE loopback flow, then stores the
target-scoped deployment token in the operating-system credential vault.
Tokens expire after 12 hours.

```bash
npx hypequery login
```

Use `--cloud-url <origin>` or `HYPEQUERY_CLOUD_URL` for a self-hosted or local
Cloud instance. HTTPS is required except for loopback development origins.

Once logged in, `hypequery deploy` automatically uses the stored endpoint and
token. Explicit `HYPEQUERY_API_TOKEN` and `HYPEQUERY_DEPLOYMENT_ENDPOINT`
values take precedence, which preserves non-interactive CI usage.

### `hypequery logout`

Revokes the current Cloud token and removes it from the operating-system
credential vault:

```bash
npx hypequery logout
```

### `hypequery deployment:release`

Prepares a deterministic release request from a verified deployment bundle and
an explicit project/environment target. This command does not upload, authorize,
or execute the release.

```bash
npx hypequery deployment:release analytics/hypequery-deployment \
  --project my-project \
  --environment production
```

The default output is `analytics/hypequery-deployment.release.json`. It is
written beside the bundle because adding it inside the closed bundle would
invalidate bundle verification.

Options:

- `--project <project>`: required target project identifier
- `--environment <environment>`: required target environment identifier
- `--output <path>`: release JSON path, default beside the bundle

### `hypequery deploy`

Submits a verified deployment bundle with an already-prepared target-bound
release. The command verifies both inputs again, requires their bundle
identities to match, and streams only the files declared by the bundle.

```bash
npx hypequery deploy analytics/hypequery-deployment \
  --release analytics/hypequery-deployment.release.json
```

For local development, run `hypequery login` first; the CLI reads the endpoint
and token from its secure Cloud profile. For CI and manual credentials, set
`HYPEQUERY_API_TOKEN` and either pass `--endpoint` or set
`HYPEQUERY_DEPLOYMENT_ENDPOINT`. Tokens are never accepted as command-line
arguments, keeping them out of shell history. The submission endpoint must use
HTTPS and must not contain credentials or a URL fragment. Explicit environment
values override the stored profile. The release identity is sent as the
idempotency key, so an unchanged release can be submitted safely again.

This command submits immutable deployment inputs. Activation, status changes,
promotion, and rollback remain control-plane operations.

Options:

- `--release <path>`: required target-bound release JSON
- `--endpoint <url>`: HTTPS submission endpoint; defaults to `HYPEQUERY_DEPLOYMENT_ENDPOINT`

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
