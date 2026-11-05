# Open-source MCP roadmap (TypeScript + Python)

**Status:** Draft for review
**Drafted:** 5 November 2026
**Scope:** `@hypequery/mcp` (`packages/mcp-server`), `hypequery.mcp`
(`python/hypequery/src/hypequery/mcp`), both CLIs' `mcp` commands, and the
shared fixtures under `specs/mcp/`.

## Goal

Ship the open-source half of the MCP announcement:

- local and self-hosted MCP from one semantic model;
- OAuth (resource-server side), tenant isolation and query limits;
- structured results and richer dataset metadata;
- tracing hooks and an eval runner.

Work that needs hosted infrastructure, stored history or a team UI stays out of
scope here. That includes the OAuth authorization server (client registration,
consent, SSO), stored traces and eval history, and release history with
rollback. Those belong to Cloud.

## Ground rules

1. **Every feature lands in both languages, held to a shared fixture.** The bar
   is the same as `specs/mcp/bridge-manifests-v1.json`: TypeScript generates
   it, Python asserts the same bytes. A feature without a fixture isn't done.
2. **Build on the client-contract path.** Python serves MCP only through
   `ClientContractExecutor` (an in-process `Api` or HTTP). TypeScript has two
   executors: the registry-based local one (`executor.ts`) and the contract-based
   HTTP bridge (`http-executor.ts`). Anything built only on the TypeScript local
   executor has no Python counterpart, so new features target the contract.
3. **The prompt never supplies the tenant.** Tenant and principal come from
   trusted configuration or a verified credential, as they do today.
4. **Annotations stay untrusted.** Per RFC 0018, new metadata is presentation
   data. It grants nothing and must never be parsed for instructions.
5. **Python layering stays intact.** Only `hypequery.mcp.server` imports the
   MCP SDK (enforced by import-linter in `pyproject.toml`). New transports go
   there; executor logic stays SDK-free.

## Where things stand

| Area | TypeScript | Python |
|---|---|---|
| stdio | `startStdioMCPServer`, `hypequery mcp` | `serve_stdio`, `hypequery mcp` |
| Remote (HTTP) MCP server | None. The README says the package "does not create an HTTP endpoint" | None |
| Contract-based executor | `createMCPHttpExecutor` | `ClientContractExecutor` with `api` and `http` backends |
| Tenant from trusted config | `tenantId`, `--tenant` | Comes from `Api` auth through the in-process backend |
| Query limits and budgets | `queryLimits`, `executionBudget`, `catalogBudget` | `QueryLimits`, `ExecutionBudget`, `CatalogBudget` |
| Structured results | `structuredContent` and output schemas | Same, pinned by `bridge-manifests-v1.json` |
| Field metadata in tools | Local mode emits `synonyms`, `unit`, `format`, `currency` (`tool-manifest.ts`) | Only `label` and `description`: RFC 0018 annotations carry nothing else |
| OAuth / JWT | JWT in `@hypequery/serve`; none in MCP | JWT and JWKS in `serve/core`; none in MCP |
| Tracing | `ServeQueryLogger` in serve only | `serve/events.py` only |
| Evals | None (`fixtures/mcp-cloud-v1/questions.json` comes close) | None |
| Resources and completions | Not implemented | Not implemented |

## Phase 0: one execution path in TypeScript (enabler)

**MCP-00: Run TypeScript local mode through the client contract.**
In local mode, build a `ProtocolClientContract` from the registry using
`buildClientContract` (K-12 in `plans/cloud-client-contract.md`), and serve it
with the same planning and validation code as the HTTP bridge. Keep
`createMCPServer` and `createMCPExecutor` as entry points, since shipped exports
stay. Remove `legacy-agent-catalog.ts` usage and the `any` casts in
`prompts/dataset-guide.ts` once nothing depends on them.

- **Why first:** after this, every later feature has one TypeScript
  implementation to keep in step with Python, not two.
- **Risk:** today local mode shows synonyms, units and formats that the contract
  doesn't carry. MCP-03 has to land before or alongside this, or local users
  lose that metadata.
- **Done when:** local and bridge modes produce byte-identical `tools/list` for
  the `client-contract-v1` success contracts.

## Phase 1: self-hosted remote MCP (P0)

**MCP-01: Streamable HTTP transport.**

- TypeScript: add `createMCPHttpHandler(options)`, a Fetch
  `(Request) => Response` handler built on the SDK's
  `StreamableHTTPServerTransport` (SDK ^1.32), plus a Node `listen` helper.
  Expose it as `hypequery mcp --http [--port] [--host]`, defaulting to loopback.
- Python: add `create_mcp_asgi_app(...)` in `hypequery.mcp.server` using the
  `mcp` SDK's streamable HTTP app (mcp>=2.3), mountable inside an existing
  ASGI `Api`. Expose it as `hypequery mcp --http`.
- **Principal per session:** a `resolvePrincipal(request)` hook returns
  `{ tenantId, headers }` or rejects. Each MCP session is bound to one principal
  and one executor, per the bridge rule "one executor/session per principal".
  A request whose principal doesn't match the session's gets a 403, and the
  session is not rebound. In Python's in-process mode, forward the verified
  `Authorization` header into `Api.handle` so serve's existing auth, tenant and
  rate-limit pipeline runs unchanged.
- **Built-in auth for v1:** a static bearer key (`HYPEQUERY_MCP_API_KEY`,
  already used by the CLI for hosted endpoints). OAuth arrives in MCP-02.
- **Hardening:** check `Origin` (DNS-rebinding protection), cap the session
  count and body size, time out idle sessions, and never echo credentials in
  errors.
- **Fixture:** `specs/mcp/http-transport-v1/` with request/response cases for
  initialize, a missing or bad key (401), a principal mismatch (403), session
  reuse, an unknown session (404) and a bad origin. Both test suites replay it.

**MCP-02: OAuth resource server.** This is the open-source half of OAuth.

- Serve Protected Resource Metadata (RFC 9728) at
  `/.well-known/oauth-protected-resource`, naming the configured authorization
  servers.
- On 401, return `WWW-Authenticate: Bearer resource_metadata="…"`, as the MCP
  authorization spec requires.
- Validate JWT access tokens with the existing verifiers: `@hypequery/serve`'s
  JWT auth in TypeScript, `serve/core/jwt_auth.py` and `jwks.py` in Python.
  Check `aud` against the server's resource identifier (RFC 8707) and reject
  tokens issued to anyone else. No token passthrough to the backend.
- Map claims to a principal with declarative config, e.g.
  `{ tenantClaim: 'org_id', scopesClaim: 'scope', requiredScopes: ['analytics:read'] }`,
  feeding MCP-01's `resolvePrincipal`.
- **Not included:** an authorization server, dynamic client registration, or a
  consent screen. Document using any OIDC provider (Auth0, Clerk, WorkOS,
  Keycloak) or Cloud.
- **Fixture:** extend `http-transport-v1` with JWKS and token cases: expired,
  wrong audience, missing scope, missing tenant claim, and success.

## Phase 2: richer metadata (P0, parallel with Phase 1)

**MCP-03: Extend RFC 0018 annotations.**
Amend RFC 0018 so `annotations.fields[*]` can also carry `synonyms`,
`examples`, `unit`, `format` and `currency`. The deployment contract already
validates these (`packages/protocol/src/deployments/validate.ts`,
`python/.../protocol/deployment_primitives.py`), so this is a projection, not a
new vocabulary. Keep the existing text rules, add list bounds (count and bytes),
and make sure annotations stay out of `schemaHash`.

- Update `buildClientContract` (TypeScript) and the Python client-contract
  builder.
- Surface the new fields in `get_dataset_schema` output schemas for both
  servers.
- Regenerate `tool-schemas-v1.json` and `bridge-manifests-v1.json`, review the
  diff, and add annotation cases to `client-contract-v1`.
- Watch version skew: v1 consumers reject unknown annotation members, so ship
  readers in both languages before producers emit the new fields, or gate them
  behind a contract minor version.

**MCP-04: `list_dimension_values` tool (optional, measure first).**
Returns the distinct values of one groupable, visible dimension, bounded
(default 50, at most 200), with an optional prefix filter. It plans as an
ordinary dimension-only semantic query through the same validation, so field
visibility, row policies, tenancy and limits all apply. It stops agents guessing
`'US'` vs `'United States'`. It adds a fifth tool, so it changes
`bridge-manifests` and must ship in both languages at once. Gate it on eval
results from MCP-06 showing a real accuracy gain.

## Phase 3: tracing (P1)

**MCP-05: Tool-call events and OpenTelemetry.**

- Add an `onEvent` / `on_event` hook on both executors, firing
  `tool.started`, `tool.completed` and `tool.failed` with: tool name, dataset,
  manifest hash, contract hash, duration, row count, cache outcome, error code
  and category, and request ID.
- Leave argument values and rows out by default (they can carry PII). An
  `includeArguments` opt-in emits field names only, never filter values.
- Add an optional OpenTelemetry adapter: an `@hypequery/mcp/otel` subpath export
  with `@opentelemetry/api` as an optional peer, and a Python `otel` extra.
  Use the OpenTelemetry GenAI/MCP semantic-convention attribute names where
  they exist.
- Send `traceparent` from the HTTP bridge and the Python HTTP backend so
  backend serve spans join the MCP span.
- Pin event names, attributes and redaction in `specs/mcp/events-v1.md` with a
  fixture of expected events for the `mcp-cloud-v1` questions.
- Keep this separate from CLI product telemetry (`specs/telemetry/`). These
  hooks send nothing anywhere by default.

## Phase 4: evals (P1)

**MCP-06: `hypequery eval` (deterministic tool-call evals).**

- File format (`specs/mcp/evals-v1.schema.json`), one case per entry:
  `{ id, question?, call: { tool, arguments }, expect: { rows? | rowCount? | columns? | error?: { code } }, tolerance? }`.
  Seed it from `fixtures/mcp-cloud-v1/questions.json`.
- The runner executes calls through the real executor (contract path,
  trusted tenant from flags), compares results, and writes a JUnit report (for
  CI) and a JSON report whose shape is pinned so Cloud can ingest it later.
  The exit code is non-zero on failure.
- Optionally check a case against raw ClickHouse SQL as ground truth, for
  semantic-layer regression tests in the spirit of `testing/*.md`.
- Ship `hypequery eval` in both CLIs, with a shared fixture of cases and
  expected reports run against the `mcp-cloud-v1` seed data.
- **Later, not now:** agent-in-the-loop evals that ask a model the `question`
  and score the tool call it picks. The `question` field keeps the format ready
  for that, but a bring-your-own-model runner is a separate decision.

## Phase 5: protocol coverage (P2)

**MCP-07: Resources.** Expose `hypequery://catalog` and
`hypequery://datasets/{name}` as read-only resources, mirroring
`get_dataset_schema` output, for clients that pin context through resources.

**MCP-08: Contract change notifications.** When the bridge detects a new
authorized view, it emits `notifications/tools/list_changed` (and
`resources/list_changed`) instead of only invalidating the session. Queries are
still never replayed against new semantics.

**MCP-09: Completions.** `completion/complete` for prompt and resource
arguments (dataset and field names only). Values come from MCP-04, never from
ad-hoc queries.

## PR stack and order

| PR | Depends on | Languages | Size |
|---|---|---|---|
| MCP-03a: RFC 0018 amendment and fixtures | none | spec | S |
| MCP-03b: readers in both languages | 03a | TS + Py | S |
| MCP-03c: builders emit fields; tool schemas surface them | 03b | TS + Py | M |
| MCP-00: TypeScript local mode on the contract path | 03c | TS | M |
| MCP-01a: HTTP transport fixture | none | spec | S |
| MCP-01b: TypeScript Streamable HTTP and `--http` | 01a | TS | M |
| MCP-01c: Python ASGI app and `--http` | 01a | Py | M |
| MCP-02: OAuth resource server | 01b, 01c | TS + Py | M |
| MCP-05: events, OpenTelemetry, `traceparent` | 00 | TS + Py | M |
| MCP-06: `hypequery eval` | 00 | TS + Py | M |
| MCP-04: `list_dimension_values` | 06 (to measure it) | TS + Py | S |
| MCP-07, 08, 09 | 00 | TS + Py | S each |

Phases 1 and 2 can run in parallel. Each PR that changes a published package
needs a changeset, and each new public API needs type tests (`test:types`).

## Docs

- `website-next/docs/(connect)/mcp/`: add self-hosting over HTTP, OAuth with an
  external identity provider, tracing, and evals pages. Lead with
  `createDatasetClient({ queryBuilder })` per repo policy.
- Update the `packages/mcp-server` README's "does not create an HTTP endpoint"
  line once MCP-01 ships.
- Add a short table of what's in open source and what's in Cloud to the MCP
  overview page.

## Open questions

1. Should the TypeScript HTTP handler live in `@hypequery/mcp` or reuse
   `@hypequery/serve` adapters, so MCP can mount beside REST routes on one
   server? Python's in-process `Api` backend argues for mounting beside serve.
2. Should MCP-04 be a fifth tool or an option on `get_dataset_schema`? A new
   tool changes every client's manifest hash.
3. Gate the new annotation members behind a contract minor version, or rely on
   shipping readers first?
