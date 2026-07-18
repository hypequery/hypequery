---
'@hypequery/serve': minor
---

Normalize auth overrides across queries, datasets, and metrics. Semantic entries
with `auth: null` now continue to inherit global auth; use
`requiresAuth: false` to make a dataset or metric endpoint explicitly public.

Compatibility note: semantic endpoints that previously used `auth: null` as a
public override must migrate to `requiresAuth: false`. This breaking behavior
change ships as a minor deliberately because `@hypequery/serve` is 0.x, where
breaking changes use the minor version slot.
