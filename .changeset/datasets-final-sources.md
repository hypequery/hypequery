---
'@hypequery/datasets': minor
---

Add `final: true` to dataset definitions for ReplacingMergeTree and CollapsingMergeTree sources. Every query on the dataset, every join that targets it and `checkRelationships` read the source with ClickHouse `FINAL`, so unmerged row versions are no longer counted and soft-deleted keys (`ReplacingMergeTree(ver, is_deleted)`) disappear. Builders gain an optional `final()` protocol method; a final dataset is refused with a clear error on builders without it, on semantic backends, and when publishing to the deployment contract, which cannot carry the flag yet. Datasets without `final` generate identical SQL and keep their cache keys.
