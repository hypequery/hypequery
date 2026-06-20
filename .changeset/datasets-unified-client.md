---
"@hypequery/datasets": minor
---

Introduce the unified semantic dataset client and execution architecture.

`createDatasetClient` now executes both datasets and metrics through either the
query-builder protocol or a database-specific semantic backend. The package
adds neutral semantic plans, an in-memory backend, dataset query execution,
derived-metric validation, and a public internal protocol export for adapters.

Query validation now covers dataset limits, field/operator compatibility,
derived metric grouping, pagination input, and supported time grains. Runtime
tenant predicates are injected consistently, and attempts to override enforced
tenant filters are rejected.
