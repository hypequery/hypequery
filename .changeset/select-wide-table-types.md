---
"@hypequery/clickhouse": patch
---

Keep `select()` and `selectConst()` type checking linear on wide tables.

String aliases were validated by expanding every column into a
`` `${column} ${'as' | 'AS' | 'As' | 'aS'} ${string}` `` union, so a table with
~1,000 columns produced tens of thousands of template literal types and
exhausted the compiler. The constraint now accepts any `x as y` pattern and each
selection is checked on its own, so unknown columns and unknown aliased columns
are still rejected. A bad column in `select([...])` now reports
"No overload matches this call" rather than pointing at the element.
