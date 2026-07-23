---
'@hypequery/clickhouse': patch
---

Fix AND/OR precedence for logical groups in WHERE/PREWHERE/HAVING (#348). `expr.or(...)` / `expr.and(...)` groups are now parenthesized as a whole, so an OR group ANDed alongside other conditions (e.g. a tenant scope) can no longer rebind and escape those conditions. Raw fragments containing a top-level AND/OR are also wrapped when combined with sibling conditions, including multiple `having()` fragments. The scanner now follows ClickHouse quoting, heredoc, delimiter, and comment rules, and trailing line comments are safely terminated before generated SQL is appended. This closes data-scoping holes where OR branches or comments could silently bypass sibling filters.
