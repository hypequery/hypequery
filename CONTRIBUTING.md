# Contributing to hypequery

Thanks for helping make hypequery better! This repo is a pnpm monorepo backed by Turbo. The steps below keep your PRs consistent with our tooling and release flow.

## Prerequisites

- Node.js 20+
- pnpm 8+ [`corepack enable pnpm` works great]
- Docker (optional: required only when running ClickHouse integration tests)

Clone the repo and install dependencies:

```bash
git clone https://github.com/hypequery/hypequery.git
cd hypequery
pnpm install
```

pnpm asks to reinstall from scratch occasionally—accepting the prompt is safe.

## Repo layout

| Path | Description |
|------|-------------|
| `packages/clickhouse` | core query builder, CLI entrypoints, docs tooling |
| `packages/serve` | `defineServe`, router, adapters |
| `packages/react` | TanStack Query hooks + helpers |
| `packages/cli` | `npx hypequery …` commands |
| `examples/*` | integration demos (Next, Vite, agents, etc.) |
| `website/` | starlight docs + blog |

## Common scripts

From the repo root:

```bash
pnpm build        # turbo run build across workspaces
pnpm test         # runs unit + type tests for @hypequery/* packages only
pnpm lint         # eslint via turbo
pnpm types        # project references / declaration builds
```

Package-specific commands are available via `pnpm --filter <workspace> <script>` (e.g., `pnpm --filter @hypequery/react test`).

### Type tests

Each published package has a `test:types` target driven by `tsconfig.type-tests.json`. These run automatically when you call `pnpm test`, but you can run them manually, too:

```bash
pnpm --filter @hypequery/react test:types
pnpm --filter @hypequery/serve test:types
```

### Integration tests

ClickHouse integration tests spin up a local Docker container. Run them only when you need to validate query builder + server behavior end-to-end:

```bash
pnpm --filter @hypequery/clickhouse test:integration
```

## Making changes

1. Create a feature branch: `git checkout -b feat/my-change`
2. Implement your update.
3. Add/adjust tests (unit + type tests). Examples should continue to build, but the default `pnpm test` only covers the `@hypequery/*` packages.
4. Run formatting/linting as needed (eslint, prettier if touched).
5. Run `pnpm test` before opening a PR.

### Recording releases (Changesets)

We use [Changesets](https://github.com/changesets/changesets) to manage package versions. A GitHub Action comments on every PR that touches publishable packages, reminding you to run `pnpm run changeset` if one isn’t detected. Most contributors can wait for that bot prompt, run the command locally, and commit the generated file.

When a PR is merged, Changesets handles the versioning flow automatically in the main release pipeline.
> For the initial publish of `@hypequery/cli`, `@hypequery/react`, or `@hypequery/serve` at `0.0.1`, you can run `pnpm run release:publish -- --filter @hypequery/cli --filter @hypequery/react --filter @hypequery/serve` without creating a changeset. Changesets will skip bumping and just push the existing versions.

## Pull request checklist

- [ ] Tests pass (`pnpm test`), or failing tests are explained/ignored with justification
- [ ] Type tests updated if public types changed
- [ ] Changeset added for any package that needs a release
- [ ] Examples/docs touched if behavior changed
- [ ] CI-only release job is still disabled (manual publish required until rebrand)

## Questions?

Open a Discussion or ping the maintainers via GitHub issues.

Thanks for contributing!
