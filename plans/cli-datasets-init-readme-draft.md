# CLI Datasets Init README Draft

Draft copy for the `@hypequery/cli` README when the datasets scaffold is released.

## `hypequery init`

`hypequery init` scaffolds a Hypequery analytics directory. By default it keeps the existing query-builder route setup.

```bash
npx hypequery init
```

Default query-builder scaffold:

```text
analytics/client.ts
analytics/schema.ts
analytics/queries.ts
.env
.gitignore
```

Interactive setup asks for:

- ClickHouse connection details
- output directory, such as `analytics/`, `src/analytics/`, or a custom path
- scaffold style: query-builder routes or datasets semantic API
- optional example query table when a ClickHouse connection is available

If the ClickHouse connection is skipped or unavailable, `init` still creates placeholder files so the project can be filled in later.

## Datasets Scaffold

Use the datasets style to scaffold the semantic API entrypoint:

```bash
npx hypequery init --style datasets
```

Datasets scaffold:

```text
analytics/client.ts
analytics/schema.ts
analytics/datasets.ts
analytics/api.ts
.env
.gitignore
```

`init --style datasets` does not generate every ClickHouse table by default. In interactive mode, it prompts for the tables to scaffold as datasets. In non-interactive mode, it writes a placeholder `datasets.ts` unless table generation is explicitly requested.

Generate selected datasets during init:

```bash
npx hypequery init --style datasets --tables orders,customers
```

Generate all discovered tables during init:

```bash
npx hypequery init --style datasets --all-tables
```

Exclude tables from generation:

```bash
npx hypequery init --style datasets --all-tables --exclude-tables raw_events,audit_log
```

When no ClickHouse connection is available, datasets init creates:

```text
analytics/schema.ts     # placeholder schema
analytics/datasets.ts   # placeholder exampleEvents dataset
analytics/api.ts        # createAPI entrypoint
```

After configuring `.env`, regenerate schema types and datasets:

```bash
npx hypequery generate --path analytics
npx hypequery generate:datasets --path analytics --tables orders,customers
```

## `hypequery generate`

`hypequery generate` regenerates TypeScript schema types from ClickHouse. It does not generate semantic dataset definitions.

```bash
npx hypequery generate
```

Options:

- `--output <path>`: explicit schema output file
- `--path <path>`: analytics directory, writes `<path>/schema.ts`
- `--tables <names>`: comma-separated table list
- `--database <type>`: currently `clickhouse`

Examples:

```bash
npx hypequery generate --path analytics
npx hypequery generate --tables orders,customers
npx hypequery generate --output analytics/schema.ts
```

## `hypequery generate:datasets`

`hypequery generate:datasets` generates semantic dataset definitions from ClickHouse schema introspection.

```bash
npx hypequery generate:datasets --path analytics --tables orders,customers
```

Options:

- `--output <path>`: explicit datasets output file
- `--path <path>`: analytics directory, writes `<path>/datasets.ts`
- `--tables <names>`: comma-separated table list
- `--exclude-tables <names>`: comma-separated exclusion list

Examples:

```bash
npx hypequery generate:datasets --path analytics --tables orders,customers
npx hypequery generate:datasets --path analytics --exclude-tables raw_events,audit_log
```

## `hypequery dev`

`hypequery dev` can load either scaffold style.

Default discovery checks API-style files first, then query files:

```text
hypequery.ts
analytics/api.ts
src/analytics/api.ts
api.ts
src/api.ts
analytics/queries.ts
src/analytics/queries.ts
queries.ts
src/queries.ts
```

Load a specific analytics directory:

```bash
npx hypequery dev --path analytics
```

This checks:

```text
analytics/api.ts
analytics/queries.ts
```

