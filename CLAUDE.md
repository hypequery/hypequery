# hypequery monorepo

TypeScript-first ClickHouse toolkit: type-safe query builder, semantic layer (datasets), HTTP serving, React hooks, CLI, and MCP server.

## Layout

pnpm + Turbo monorepo. `pnpm-workspace.yaml` is the authoritative workspace list.

| Path | What it is |
|------|------------|
| `packages/clickhouse` | Core query builder (`@hypequery/clickhouse`) |
| `packages/datasets` | Semantic layer: datasets, measures, dimensions |
| `packages/serve` | `defineServe`, router, HTTP adapters |
| `packages/react` | TanStack Query hooks |
| `packages/cli` | `npx hypequery …` commands |
| `packages/mcp-server` | `@hypequery/mcp` — exposes datasets to agents |
| `packages/protocol` / `packages/protocol-conformance` | Security protocol + cross-language conformance runner |
| `packages/deployment` | Deployment contracts and tooling |
| `packages/tsconfig` | Shared tsconfig presets — new packages extend this |
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
pnpm --filter @hypequery/<pkg> <script>   # per-package (build, test, test:unit, test:types, ...)
pnpm test:integration   # ClickHouse integration tests — requires Docker
pnpm conformance        # protocol conformance runner (build packages first)
pnpm smoke:consumers    # all consumer smoke tests (scripts/smoke-*.sh)
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
  `canary` dist-tag for `@hypequery/clickhouse`, `@hypequery/datasets`,
  `@hypequery/deployment`, `@hypequery/serve`, `@hypequery/cli`,
  `@hypequery/mcp`, `@hypequery/protocol`,
  `@hypequery/protocol-conformance`, and `@hypequery/react`. No manual steps.
- **Stable**: Changesets-driven. Any user-facing change to a published package needs a changeset (`pnpm changeset`) in the PR. Full flow in `release-commands.md`.

## Testing philosophy

`testing/*.md` are self-contained specs meant to be executed by a model against a **real, already-populated ClickHouse** (env: `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`). They are read-only (except CLI journey J2), introspect the live schema, and verify against ground-truth raw SQL. Each spec ends with an Appendix A of doc/code discrepancies — treat new mismatches as doc bugs to file, separate from pass/fail.
