---
"@hypequery/datasets": patch
---

Result cache keys now separate engines. A query on a non-ClickHouse engine, such as Postgres, folds that engine into its key, so clients on different engines that share a cache store and secret never serve each other's results. ClickHouse keys are unchanged.
