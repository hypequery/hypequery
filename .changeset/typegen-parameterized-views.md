---
"@hypequery/cli": patch
---

Type generation now gives parameterized views their columns. ClickHouse describes such a view as having no columns, so the generated type was empty. The generator now describes a call to the view with each parameter's default value, and adds a comment that lists the parameters. Each table is now described once instead of twice. `SimpleAggregateFunction(fn, T)` columns are typed by `T` in the generated record interfaces.
