---
'@hypequery/datasets': minor
---

Add dataset segments (RFC 0015, HQ-77). `dataset(..., { segments })` declares named row filters, each an AND of comparisons over the dataset's own dimensions, and queries select them with `segments: [...]`.
- Segments may use dimensions that callers cannot filter on. They cannot traverse relationships or constrain the tenant column, and they are validated when the dataset is defined.
- They apply on every execution path, and the result cache key includes their resolved definitions.
- Catalogs, the semantic contract, and the agent-safe catalog list segment names, labels, and descriptions, never their conditions.
- Publishing refuses datasets with segments until deployment contract 3 is emitted.
