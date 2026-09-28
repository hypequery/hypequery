---
"@hypequery/datasets": minor
"@hypequery/mcp": patch
---

Execute trailing, to-date, and cumulative dataset measures through the query-builder client, including sparse-series filling, lookback filters, and derived formulas. Expose window parameters and time-range requirements in catalogs and agent projections. MCP dataset guides list these measures with their time-axis requirements.

Reject ranges that cross a skipped local calendar bucket, including window lookback, instead of generating duplicate buckets and incorrect totals.
