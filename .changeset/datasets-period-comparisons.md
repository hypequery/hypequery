---
"@hypequery/datasets": minor
"@hypequery/mcp": patch
---

Add `measure.shift` for period comparisons through the query-builder client. Shifted measures share window time-axis validation, gap filling, filters, tenant scope, and derived formulas. Catalogs and agent projections expose their intervals and time-range requirements.

Reject shifted source ranges that cross a skipped local calendar bucket, including empty populations, rather than duplicating comparison values.

Comparisons match partial query ranges and preserve endpoint operators. Catalogs and agent projections expose compatible grains for time measures and their formulas.
