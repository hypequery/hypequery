# @hypequery/examples-schema

Private workspace package. Owns the manifest schema for the hypequery examples
registry and the validator that runs in `pnpm lint`.

The registry is two folders at the repo root:

| Folder | Manifest | `kind` |
| --- | --- | --- |
| `examples/<slug>/` | `example.json` | `example` |
| `recipes/<slug>/` | `recipe.json` | `recipe` |

Folders whose name starts with `_` (for example `examples/_seed`) are not
registry entries and are skipped. The site (`/examples`, `/recipes`, Markdown
twins, `llms.txt`), the CLI (`hypequery examples list`, `hypequery create`) and
the examples CI workflow all read these manifests. Nothing else is a source of
truth for what an example is.

## Commands

```bash
pnpm --filter @hypequery/examples-schema validate      # validate every manifest in the repo
pnpm --filter @hypequery/examples-schema schema:write  # regenerate schema/*.schema.json
pnpm --filter @hypequery/examples-schema test
```

`pnpm lint` at the repo root runs the validator and checks that the committed
JSON Schema files are up to date, so an invalid manifest fails CI with a
readable, per-file error list.

## Manifest reference

All fields are required unless marked optional. Unknown keys are rejected.

| Field | Type | Notes |
| --- | --- | --- |
| `$schema` | string, optional | Editor hint. Use `https://hypequery.com/schemas/example.schema.json` (or `recipe.schema.json`). |
| `slug` | string | Kebab-case. Must equal the folder name. Unique across examples and recipes. |
| `kind` | `"example"` or `"recipe"` | Must match the folder the manifest lives in. |
| `title` | string | Up to 120 characters. |
| `outcome` | string | One hand-written line, up to 160 characters. Doubles as the meta description. |
| `language` | `"typescript"` or `"python"` | |
| `stack` | string[] | Kebab-case, e.g. `["nextjs", "react"]`. Drives injection into `/clickhouse-nextjs` and friends. |
| `useCases` | string[] | Kebab-case, e.g. `["dashboards", "multi-tenant"]`. |
| `packages` | string[] | `@hypequery/<name>` npm packages, or `hypequery` for PyPI. At least one. |
| `keyFile` | string | Relative path inside the folder; shown inline on the page. Keep it under ~80 lines. |
| `env` | `{ name, description, required }[]` | `name` is UPPER_SNAKE_CASE. |
| `run` | `{ install, dev, test }` | The commands the CI harness and the CLI print. |
| `exampleRequest` | string, optional | A curl command or query an agent can run to verify the example. The smoke test asserts its result shape. |
| `related` | string[] | Slugs of other examples or recipes. Default `[]`. Must resolve. |
| `leadPages` | string[] | Existing site paths whose page shows this item's block, e.g. `"/clickhouse-nextjs"`. Default `[]`. |
| `functionPages` | string[] | `/clickhouse/functions/<slug>` slugs, e.g. `"quantile"`. Default `[]`. |
| `keywords` | string[] | From Search Console, not guesses. At least one. |
| `minVersion` | string | Semver of the oldest hypequery release the example is tested against. |

Recipes add three required file references, all relative to the folder:

| Field | Notes |
| --- | --- |
| `datasetFile` | The hypequery dataset definition the recipe is built on. |
| `expectedSqlFile` | The SQL hypequery is expected to generate. The smoke test asserts it. |
| `outputFile` | Captured output over the seed dataset, shown on the page. |

Every entry also needs a `README.md`. Its block order drives the page and the
Markdown twin: one-line outcome, demo or screenshot, install command, what it
shows (3 to 5 bullets), key file inline, architecture sketch, "adapt it" notes,
related recipes, related examples.

## Programmatic use

```ts
import { ExampleManifest, validateRegistry, toJsonSchema } from '@hypequery/examples-schema';

const manifest = ExampleManifest.parse(JSON.parse(raw));
const { manifests, issues } = validateRegistry(repoRoot);
const jsonSchema = toJsonSchema('example');
```

`validateRegistry` is what the site build (`website-next/lib/examples.ts`) and
the CLI's registry export are expected to call, so a schema error fails the
build instead of rendering a broken page.
