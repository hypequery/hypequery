---
"@hypequery/clickhouse": minor
---

Fix two long-standing CTE gaps in the query builder.

CTE aliases are now typed join targets. `withCTE('alias', builder)` derives the
alias's columns from the builder passed in, and `withCTE('alias', sql, columns)`
takes a column declaration for a raw SQL body. Joining the alias, selecting
`alias.column`, and filtering on it are all checked, and the column types flow
through to the result row. A raw CTE with no declared columns behaves as before:
it renders, but its alias is not a typed join target. Joining a CTE does not
accept the trailing table-alias argument, which resolves through the schema.

CTE values also stay bound. `withCTE` previously rendered a builder subquery with
`toSQL()`, escaping its values into the CTE string while the rest of the query
used bound parameters. The CTE body now keeps its placeholders and contributes
its parameters ahead of the outer query's. Rendered SQL is unchanged, as is the
`ctes` array on the deprecated `getConfig()`.
