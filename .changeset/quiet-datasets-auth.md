---
'@hypequery/serve': minor
---

Normalize auth overrides across queries, datasets, and metrics. Semantic entries
with `auth: null` now continue to inherit global auth; use
`requiresAuth: false` to make a dataset or metric endpoint explicitly public.
