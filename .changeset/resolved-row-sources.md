---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
---

Add explicit `rowResolution` policies for ClickHouse replacing/collapsing sources.
The datasets planner reads FINAL rows before deletion/sign and caller predicates,
including relationship, metric and time scans. Deployment contracts preserve the
policy on validation, hashing and rehydration. Unsupported SQL dialects and frozen
semantic backends reject these datasets instead of aggregating physical versions.
