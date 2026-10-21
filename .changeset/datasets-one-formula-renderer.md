---
'@hypequery/datasets': patch
---

Render derived metric formulas through the datasets SQL dialect, the same renderer derived measures use, instead of `FormulaExpr.toSQL()`. Generated SQL changes only in parenthesization (`(a) / (NULLIF(b, 0))` becomes `(a / NULLIF(b, 0))`); results are unchanged. A derived metric formula that references an input not declared in `uses` is now rejected rather than written into the SQL. `FormulaExpr.toSQL()` itself is unchanged.
