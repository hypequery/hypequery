---
"@hypequery/datasets": patch
---

Fix the `dataset()` JSDoc example so the `belongsTo` join names the physical `customer_id` column rather than the `customerId` dimension; relationship `from`/`to` keys are columns, and the dimension name fails at query time.
