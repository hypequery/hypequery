---
"@hypequery/cli": minor
---

Postgres support in the CLI:

- `hypequery init --database postgres` scaffolds a datasets project on `@hypequery/postgres`. It tests the `DATABASE_URL` connection, generates datasets from the schema, and installs `@hypequery/postgres` and `pg`.
- `hypequery generate:datasets --database postgres` generates datasets from Postgres catalogs. Postgres is also auto-detected from `DATABASE_URL`, `POSTGRES_URL` or `HYPEQUERY_POSTGRES_URL`. Generation covers every non-system schema and infers `belongsTo` relationships from single-column foreign keys.

Telemetry now reports `postgres` as a database value.
