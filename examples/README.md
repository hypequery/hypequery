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
   `hypequery create` pins published versions.
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

An example whose CI job fails is unlisted on the site until it is fixed. It is
never shipped broken.
