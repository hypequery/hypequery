---
'@hypequery/datasets': minor
'@hypequery/mcp': patch
---

Add typed authoring definitions for trailing, to-date, and cumulative dataset measures. Validate base-measure references and cumulative aggregation support, and reject execution and Cloud publishing until RFC 0015 window planning is implemented.

Exclude window-dependent derived measures from executable catalogs and query schemas until window planning is available.

Keep base, derived, and window definitions together in the returned dataset's `measures` registry. Retain `derivedMeasures` as a deprecated compatibility alias, while default queries and standalone metrics continue to use only base measures.
