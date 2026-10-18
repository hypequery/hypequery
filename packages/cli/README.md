# @hypequery/cli

The fastest way to start a type-safe ClickHouse analytics backend in TypeScript.

`@hypequery/cli` connects to ClickHouse or embedded chDB, generates schema types, scaffolds queries or semantic datasets, and runs a local API with interactive documentation. It also generates React route manifests.

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
npx hypequery dev --open
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
| `hypequery generate:client` | TypeScript API types and routes from a Python client contract |
| `hypequery generate:manifest` | A browser-safe route manifest for React hooks |
| `hypequery pull` / `diff` | Live source inspection and comparison |
| `hypequery deployment:status` | Live release and Cloud-provided connection URLs |

Non-interactive ClickHouse commands read `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, and `CLICKHOUSE_PASSWORD`.

## Generate a client for Python endpoints

Export a build contract from your Python definition-only factory, then generate
one TypeScript file with no backend imports:

```bash
# In the Python project (the factory returns export_client_contract(...)):
hypequery export client-contract --factory analytics.contract:build --output client-contract.json

# In the frontend project:
npx hypequery generate:client ../backend/client-contract.json --output src/hypequery-client.ts
npx hypequery generate:client ../backend/client-contract.json --output src/hypequery-client.ts --check
```

The file exports `ClientApi`, `clientManifest`, `clientContractHash` and public
response metadata types. It preserves installed POST paths, endpoint schema
hashes, metric aliases, default measures, field-specific filter types and wire
nullability. Numeric dimensions can be strings on the wire; aggregate values are
strings or null. Time buckets may be null when the physical time column is null.
Results use optional fields until a consumer narrows the query's selections.

Generation reads local JSON only (1 MiB maximum); it never evaluates a backend
module or fetches an endpoint. Signed identities, duplicate JSON members and
strict contract bounds are checked before writing. Use the owner-controlled
`build` view; principal-specific live discovery is for runtime consumers.
`--check` detects drift without creating directories or changing files. Existing
output requires `--force` to replace, and symlinked output paths are refused.
Generated output is bounded to 16 MiB. TypeScript describes structural inputs;
the Python endpoint still validates timezones, selection dependencies, query
budgets and authorization on every request.

## Why use the CLI

- Get correct ClickHouse runtime types instead of guessing interfaces.
- Move from one local query to datasets, APIs, React, and MCP without changing tools.
- Keep generated types and route manifests reproducible in CI.

## Learn more

- [Quick start](https://hypequery.com/docs/quick-start)
- [CLI reference](https://hypequery.com/docs/reference/api/cli)
- [Current capabilities](https://hypequery.com/docs/capabilities)

## License

Apache-2.0.

### Python HTTP datasets over MCP

For a Python API exposing an authorized client-contract endpoint, install a
compatible `@hypequery/mcp` alongside the CLI in your Node project, then run:

```bash
# Supply the backend principal's Bearer credential through your environment.
# Omit it only when your backend intentionally authorizes public access.
export HYPEQUERY_API_KEY='your-backend-credential'
hypequery mcp --client-contract-url https://api.example.com/v1/client-contract --self-test
hypequery mcp --client-contract-url https://api.example.com/v1/client-contract
```

The self-test checks authorized discovery and tool schemas without querying
business data. Serving uses MCP stdio: stdout carries protocol messages and
status/errors go to stderr. Use the second command as your MCP client's command
and arguments; supply the credential using that client's secret/environment
configuration. Never put the credential in a URL or command argument.

Python owns authentication, tenant resolution, policy and SQL execution. One
bridge process serves one backend principal. Restart it after changing principal
or after a stale-contract error; it never silently replaces pinned schemas or
replays a query. HTTPS is required except on loopback, and redirects are refused.

`--client-contract-url` cannot be combined with a local file, `--path`, `--tenant`
or `--url`. The existing `--self-test --url` checks a hosted MCP endpoint; the
new flag points at a Python HTTP discovery endpoint. No local analytics module
or Python process is loaded by this mode. Node is needed for the MCP bridge;
the Python API itself does not require Node.

The npm packages must contain the matching client-contract features. Workspace
qualification does not imply that these changes have already been published.
