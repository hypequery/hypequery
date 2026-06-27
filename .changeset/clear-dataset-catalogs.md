---
"@hypequery/datasets": patch
"@hypequery/mcp": minor
---

Add dataset catalog metadata for measures, filters, relationships, limits, and attached named metrics. Update MCP dataset introspection and dataset querying metadata to distinguish measures from named metrics.

Breaking MCP change: `query_dataset` now accepts `measures` only. The previous `metrics` argument for dataset queries has been removed so named metrics remain reserved for `query_metric`.
