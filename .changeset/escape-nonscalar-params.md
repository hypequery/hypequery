---
'@hypequery/clickhouse': patch
---

Escape single quotes and backslashes inside stringified array/object parameter values. Previously `escapeValue` embedded `JSON.stringify(value)` into a SQL string literal without escaping it, so a quote inside an array/object value could terminate the literal and change how the surrounding WHERE parsed. Scalar strings were already escaped correctly; this brings non-scalar values in line.
