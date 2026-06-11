---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

First-class `includeMeta` request field and `rowCount` in semantic response meta.

Dataset and metric endpoints now accept an `includeMeta: boolean` input field to
opt into response `meta`, alongside the existing `x-include-meta` header (kept for
back-compat). This puts meta opt-in in the typed request body and OpenAPI schema
instead of an undocumented header side-channel.

`meta` now includes `rowCount` (the number of rows returned), populated by the
executor for both metric and dataset queries.

(`Cache-Control` headers from `cacheTtlMs` and a propagated `x-request-id` were
already emitted by the serve pipeline.)
