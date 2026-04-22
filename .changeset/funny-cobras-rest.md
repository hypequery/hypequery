---
'@hypequery/cli': minor
---

Update the CLI scaffolding and package guidance to use the current `initServe()` + `query({ ... })` + `serve({ queries })` path by default.

- generate `analytics/queries.ts` templates that destructure `{ query, serve }` from `initServe(...)`
- scaffold example queries using object-style `query({ ... })` definitions instead of the older chained builder-first serve style
- emit an exported `api = serve({ queries: { ... } })` shape by default
- align CLI docs and generated comments with the current main-path docs and dev workflow

This makes new projects start on the current serve/query API without needing a separate migration step after scaffolding.
