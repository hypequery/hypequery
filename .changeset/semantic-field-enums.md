---
"@hypequery/serve": minor
---

Generate per-dataset/per-metric request schemas with enumerated fields.

Metric and dataset endpoints previously typed their request body as
`dimensions: string[]` / `filters[].field: string`, so the OpenAPI spec (and
`hypequery dev` docs) advertised "array of arbitrary strings" and clients could
not be code-generated with valid field names.

Endpoints now build their Zod input schema from the dataset/metric contract:
`dimensions`, `measures`, `filters[].field`, and `orderBy[].field` are emitted as
enums of the valid field names, and array sizes are bounded by the dataset's
declared `limits`. The enums are a superset-safe mirror of the runtime
validators — they never reject a field the validator would accept — so behavior
is unchanged while docs and codegen become precise.
