---
"@hypequery/datasets": minor
---

Add `buildClientContract(deployment, options)`, which turns a deployment contract (for example `publishToCloud`'s output) into a signed client contract that `hypequery generate:client` reads. It follows the Python builder's rules: unknown nullability for local fields, tenant-key filters never advertised, operators narrowed by field type, portable time grains, and limits narrowed by each dataset. Relationship fields are not exported yet. Hosts pass their own routes, query ceilings and default timezone; `view: 'authorized'` with `include` gives a caller's view.
