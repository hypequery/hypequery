---
"@hypequery/datasets": minor
---

Portable execution now names why it excluded a surface. `UnsupportedContractFeatureError` and `PortableExecutionUnsupportedError` carry a `reason` from the new `UNSUPPORTED_CONTRACT_REASONS` export (for example `HQ_PORTABLE_AMBIGUOUS_MEASURE_SQL` or `HQ_PORTABLE_DERIVED_METRIC_WITHOUT_FORMULA`), alongside the unchanged `HQ_SEMANTIC_UNSUPPORTED_CAPABILITY` code. Existing constructors remain valid.
