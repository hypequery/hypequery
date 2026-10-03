---
"@hypequery/serve": minor
---

Dataset and metric HTTP metadata now contains only operational fields. SQL and tenant details require host authorization and successful auditing and are returned separately under `diagnostics`. Metadata opt-in alone never grants diagnostic access.
