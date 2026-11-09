---
"@hypequery/cli": patch
---

Report ClickHouse connection failures accurately:

- `generate`, `generate:datasets`, and `dev` no longer report "Connected to ClickHouse" with 0 tables when the database is unreachable or rejects the credentials. They now show the real error.
- A refused connection now shows its message and troubleshooting hints instead of an empty error.
- The ClickHouse client's raw stack-trace logging is off, so commands show only their own error output.
- `hypequery dev` showed Docs and OpenAPI URLs without the base path for `createAPI` entries (for example `/docs` instead of `/api/analytics/docs`). It now shows the routes the API actually serves.
