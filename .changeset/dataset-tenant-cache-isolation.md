---
"@hypequery/datasets": patch
---

Snapshot dataset and metric query inputs and tenant runtime before cache lookup,
so caller mutations during an asynchronous store read cannot cache another
tenant's result under the original tenant's key.
