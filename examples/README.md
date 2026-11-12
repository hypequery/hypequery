# hypequery examples registry

Every folder here (except `_`-prefixed ones) is one runnable example with an
`example.json` manifest. Recipes live in `../recipes/` with a `recipe.json`.
The manifests are the single source of truth for the `/examples` and
`/recipes` pages on hypequery.com, their Markdown twins and `llms.txt`, the
`hypequery examples list` and `hypequery create <slug>` CLI commands, and the
examples CI workflow.

| Folder | What it is |
| --- | --- |
| `_seed/` | The shared ClickHouse dataset every example runs against. See `_seed/README.md`. |
| `<slug>/` | One example: `example.json`, `README.md`, the code, and a smoke test. |

The manifest schema, field reference and validator live in
`packages/examples-schema`. `pnpm lint` fails on an invalid manifest, a slug
that does not match its folder, or a missing referenced file.

## Adding an example

1. Create `examples/<slug>/` with an `example.json` (`$schema` points at
   `https://hypequery.com/schemas/example.schema.json` for editor completion).
2. Depend on hypequery packages with `workspace:*`. PR CI builds and tests
   against the workspace; the nightly run swaps them for `@latest` from npm, and
   `hypequery create` pins published versions. A Python example (`language:
   "python"`) is a uv project instead: `pyproject.toml` depends on `hypequery`
   and points `[tool.uv.sources]` at `../../python/hypequery`; the nightly run
   and `hypequery create` drop that table so PyPI is used. Keep a small
   `package.json` with `dev` and `test` scripts that call `uv`, so CI and the
   CLI drive it like the others.
3. Add a `test` script that boots nothing itself: CI starts the seed
   (`docker compose -f examples/_seed/docker-compose.yml up -d --wait && pnpm seed`)
   and exports `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`
   and `CLICKHOUSE_DATABASE` before running it. The smoke test should assert the
   result shape of `exampleRequest`.
4. Write the `README.md` in this block order: one-line outcome, demo or
   screenshot, install command, what it shows (3 to 5 bullets), key file inline,
   architecture sketch, "adapt it" notes, related recipes, related examples.

Merge bar: manifest validates; `outcome` is hand-written; the example runs
from `hypequery create <slug> -y` against the seed; the smoke test asserts the
`exampleRequest` result shape; the key file is under about 80 lines; `stack`,
`leadPages` and `functionPages` are set so the example is injected into the
existing pages that already rank.

A failing smoke test fails the required `Examples OK` check, so a PR cannot
merge a broken example against the workspace packages. The nightly run against
the published packages catches what that misses (an example using an API that
is not released yet, say); nothing unlists an example automatically, so fix or
revert it when the nightly goes red. The template-repo sync skips any example
that fails against the published packages.

## Template repos

Each example is also mirrored to its own public GitHub template repo,
`hypequery/<slug>`, holding exactly what `hypequery create <slug> -y` scaffolds
(published package versions, the seed in `./seed`). The monorepo stays the
source of truth; a mirror's README says so and every sync overwrites it.

| Command | What it does |
| --- | --- |
| `node scripts/examples/publish-templates.mjs` | Export every example to `.template-export/`. Pushes nothing. |
| `node scripts/examples/publish-templates.mjs --verify` | Also install and test each export against npm/PyPI (needs the seed running). |
| `node scripts/examples/publish-templates.mjs --publish --create` | Verify, create missing repos as public templates with topics and homepage, and push. Run by hand once per new example. |

Build the CLI and the examples schema first
(`pnpm --filter @hypequery/cli... --filter @hypequery/examples-schema build`). After the
Examples workflow passes on `main`, `.github/workflows/example-templates.yml`
re-verifies and syncs every repo that already exists; it is skipped until the
`EXAMPLE_TEMPLATES_TOKEN` secret is set. An export that fails against the
published packages (an example using an unreleased API, say) is not pushed.
