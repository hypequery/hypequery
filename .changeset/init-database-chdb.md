---
"@hypequery/cli": minor
---

`hypequery init --database chdb` scaffolds a project straight onto embedded ClickHouse (chDB) — no server, no credentials, no `.env`. The scaffolded `client.ts` uses `createQueryBuilder({ adapter: chdbAdapter({ session }) })` from `chdb/hypequery`, `chdb` is installed as a scaffold dependency instead of relying on `CLICKHOUSE_*` env vars, and the connection prompts are replaced by a single storage question (in-memory by default, or an on-disk session directory such as `./analytics.chdb` via `--chdb-path`).

`hypequery generate --database chdb [--chdb-path <dir>]` introspects the embedded session — the type generator's client seam is now satisfiable by a chDB session, so schema types regenerate without an HTTP connection. `init` stores the selected driver and persistent session path in `hypequery.config.json`, allowing later `hypequery generate` calls to reuse the correct database automatically. Dependency-based detection remains as a fallback for existing chDB projects. Dataset scaffolding uses the same embedded introspection client instead of falling back to an HTTP ClickHouse connection. `chdb` stays out of the CLI's own dependencies; it is resolved dynamically from the user's project and a missing install produces an actionable error instead of a resolution failure.
