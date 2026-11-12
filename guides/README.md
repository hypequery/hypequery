# Guides

Long-form guides rendered at `/guides/<slug>` on hypequery.com. Each folder has
a `guide.json` manifest (schema: `packages/examples-schema`), a `guide.md` body,
and the SQL it teaches as separate `.sql` files. `guide.md` pulls a file in with
a line containing only `{{sql:sql/01-create.sql}}`, so the article and the
tests share one copy.

CI (`.github/workflows/examples.yml`, `guides` job) runs every `guides/**/*.sql`
against the seed dataset in `examples/_seed` on the pinned ClickHouse, in path
order. Keep statements idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) and use
table names that do not collide with the seed or the examples.

Folders starting with `_` are not pages.
