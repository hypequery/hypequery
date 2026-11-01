---
"@hypequery/datasets": minor
---

Add `buildClientContract(deployment, options)`, which turns a deployment contract (for example `publishToCloud`'s output) into a hashed client contract that `hypequery generate:client` reads. It follows the Python builder's rules: unknown nullability for local fields, tenant-key filters never advertised, operators narrowed by field type, portable time grains, and limits narrowed by each dataset. Relationship fields are not exported yet. Hosts pass their own routes, query ceilings and default timezone; `view: 'authorized'` with `include` marks a caller's view; `include` filters whole datasets only, so field-level narrowing stays with the host. Only datasets with an endpoint are exported, and a dataset with a field named `period` alongside a time field is rejected.
