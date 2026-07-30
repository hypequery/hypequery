---
"@hypequery/cli": patch
---

Drop the `@hypequery/clickhouse` dependency from the CLI.

`hypequery generate` reached into `@hypequery/clickhouse/cli` for the two
functions it needed (`generateTypes`, `clickhouseToTsType`), which pulled the
entire query builder — roughly 1.1 MB — into every CLI install. The generator
now lives in the CLI itself, so `npx @hypequery/cli` installs neither the
query builder nor its module graph.

Nothing changes for users. The query builder is still what the scaffolder
installs into *your* project, and `@hypequery/clickhouse/cli` plus the
`hypequery-generate-types` bin keep working exactly as before.
