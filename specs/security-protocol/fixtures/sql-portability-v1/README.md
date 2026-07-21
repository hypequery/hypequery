# SQL portability v1 fixtures

- `portable.json` maps SQL expression fragments in the supported subset to
  their RFC 0003 expression AST and sorted dependency identifiers.
- `non-portable.json` maps inputs outside the subset to the first
  incompatibility issue code and its start offset.

These fixtures exercise the R1A-07 SQL portability compiler. The supported
subset is deliberately small: qualified and backtick-quoted identifiers,
numeric/string/boolean/null literals, `+ - * /`, the comparison operators,
literal `IN`/`NOT IN` lists, `BETWEEN` with literal bounds, `LIKE`,
`AND`/`OR`/`NOT`, parentheses, and the RFC 0003 function allowlist
(`nullIfZero`, `coalesce`, `round`, `floor`, `ceil`). Statements, casts,
subqueries, lambdas, comments, unlisted functions, backslash escapes, and
non-literal `IN`/`BETWEEN` operands are non-portable by construction.
