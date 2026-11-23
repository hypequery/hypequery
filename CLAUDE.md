# hypequery monorepo

TypeScript-first ClickHouse toolkit: type-safe query builder, semantic layer (datasets), HTTP serving, React hooks, CLI, and MCP server.

## Layout

pnpm + Turbo monorepo. `pnpm-workspace.yaml` is the authoritative workspace list.

| Path | What it is |
|------|------------|
| `packages/clickhouse` | Core query builder (`@hypequery/clickhouse`) |
| `packages/cloud-client` | Typed client for hypequery Cloud's `/v1` operations, generated from `specs/cloud-api/operations-v1.json` (Cloud's copy is the source) |
| `packages/datasets` | Semantic layer: datasets, measures, dimensions |
| `packages/serve` | `defineServe`, router, HTTP adapters |
| `packages/react` | TanStack Query hooks |
| `packages/cli` | `npx hypequery …` commands |
| `packages/mcp-server` | `@hypequery/mcp` — exposes datasets to agents |
| `packages/protocol` / `packages/protocol-conformance` | Security protocol + cross-language conformance runner |
| `packages/deployment` | Deployment contracts and tooling |
| `packages/tsconfig` | Shared tsconfig presets — new packages extend this |
| `packages/examples-schema` | Private. Zod manifest schemas + validator for the examples registry (runs in `pnpm lint`) |
| `examples/` | Examples registry: `examples/<slug>/example.json` + code, plus `_seed/` (shared ClickHouse seed dataset). See `examples/README.md` |
| `recipes/` | Recipes registry (`recipe.json`), same rules as examples |
| `guides/` | Long-form guides whose `*.sql` is run against the seed in CI |
| `website-next/` | Next.js + Fumadocs site. Docs live in `website-next/docs/` |
| `testing/` | Manual, model-executable E2E test specs (see `testing/README.md`) |
| `specs/` | RFCs, decisions, and conformance fixtures (`specs/security-protocol/`) |
| `plans/` | Design docs / implementation plans |

`CONTRIBUTING.md` is partially stale: it references a `website/` Starlight site (gone — replaced by `website-next/`) and lists only 4 packages.

## Commands

```bash
pnpm build              # turbo build across workspaces
pnpm test               # unit + type tests for all @hypequery/* packages
pnpm lint               # eslint via turbo
pnpm types              # declaration / project-reference builds
pnpm api:report         # regenerate public API reports (protocol, datasets, deployment); build first
pnpm api:check          # fail if a committed API report is stale (runs in CI)
pnpm --filter @hypequery/<pkg> <script>   # per-package (build, test, test:unit, test:types, ...)
pnpm test:integration   # ClickHouse integration tests — requires Docker
pnpm conformance        # protocol conformance runner (build packages first)
pnpm smoke:consumers    # all consumer smoke tests (scripts/smoke-*.sh)
pnpm seed               # load + verify the examples seed dataset (needs examples/_seed/docker-compose.yml up)
pnpm examples:validate  # validate every example.json / recipe.json
```

- Every published package has `test:types` (driven by `tsconfig.type-tests.json`); it runs as part of `pnpm test`. Type-level changes need type tests, not just unit tests.
- Turbo's `test` inputs include `specs/security-protocol/**` — editing those fixtures invalidates test caches for dependent packages (intentional).
- `website-next` build requires a `BLOB_READ_WRITE_TOKEN` env var; set a dummy value to build locally.

## Known-stale tooling

- The TypeDoc docs pipeline (`pnpm docs:api` / `docs:mdx` / `fix:mdx`, scripts in `packages/clickhouse/scripts/`) still writes to the deleted `website/` directory. Don't run it expecting docs updates; docs are hand-maintained in `website-next/docs/` until the pipeline is repointed.

## API & architecture policies

- **Never delete a shipped export.** If a released API is superseded, restore/keep it with a `@deprecated` JSDoc tag pointing at the replacement. Removal happens only in a planned major.
- **Keep utility logic in focused files.** Reusable or independently testable pure helpers belong in the nearest `utils/` directory (or a focused domain helper module), not as top-level functions inside adapters, controllers, builders, or other feature files. Keep only behavior that depends on an owning class's state as class methods, and do not accumulate unrelated helpers in a generic `utils.ts` file.
- **New builders must mirror QueryBuilder's architecture** (state + node + features design), not merely be immutable. Study `packages/clickhouse`'s query builder before adding a builder elsewhere.
- **Dataset client docs and examples lead with `createDatasetClient({ queryBuilder })`.** `createBackend` is documented as advanced-only, never the primary path.

## Releases

- **Canary**: every push to `main` auto-publishes snapshot builds to the npm
  `canary` dist-tag for `@hypequery/agent`, `@hypequery/clickhouse`, `@hypequery/cloud-client`, `@hypequery/datasets`,
  `@hypequery/deployment`, `@hypequery/serve`, `@hypequery/cli`,
  `@hypequery/mcp`, `@hypequery/protocol`,
  `@hypequery/protocol-conformance`, and `@hypequery/react`. No manual steps.
- **Stable**: Changesets-driven. Any user-facing change to a published package needs a changeset (`pnpm changeset`) in the PR. Full flow in `release-commands.md`.
- **Publishing** uses npm trusted publishing (OIDC). There is no npm token. Every publish is checked against the registry afterwards. A failed publish on `main`, or a canary more than 3 days stale, opens a `release-failure` issue. See "Release guardrails" in `release-commands.md`.

## Public API reports

`packages/{protocol,datasets,deployment}/api-report/*.api.md` are API Extractor reports of the public types, one per `exports` entry point. Downstream consumers (hypequery Cloud above all) compile against these types. A change to them can break consumers without breaking this repo. Two past examples: widening `ProtocolDatasetContract.source` to a union, and renaming `filters` to `allowedFilters`.

- If you change public types in those packages, run `pnpm turbo run build --filter='@hypequery/*' && pnpm api:report` and commit the report diff. CI's `pnpm api:check` fails on a stale report.
- **A PR that changes a report needs a changeset for that package with a `Consumer-breaking:` line.** CI enforces this in the `release-tooling` job.
  - `Consumer-breaking: no` means the change is additive only: new exports, or new optional input fields.
  - Anything else names what breaks and how to migrate, for example `Consumer-breaking: ProtocolDatasetContract.source may now be an object. Migration: narrow with typeof source === 'string' before using it as a table name.`
  - Count these as breaking: widening an output type, narrowing an input type, renaming or removing a field or export, and making an optional field required.
  - The line goes into the changelog, which is where consumers read it.

## Testing philosophy

`testing/*.md` are self-contained specs meant to be executed by a model against a **real, already-populated ClickHouse** (env: `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`). They are read-only (except CLI journey J2), introspect the live schema, and verify against ground-truth raw SQL. Each spec ends with an Appendix A of doc/code discrepancies — treat new mismatches as doc bugs to file, separate from pass/fail.
