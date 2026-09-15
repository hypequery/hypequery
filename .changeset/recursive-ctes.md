---
"@hypequery/clickhouse": minor
---

Add `WITH RECURSIVE` CTEs, parameterized raw CTE bodies, and CTEs as typed query
sources.

`withRecursiveCTE(alias, body, columns?)` renders the clause as
`WITH RECURSIVE`. `RECURSIVE` is a property of the `WITH` clause rather than of
a single entry, so one recursive CTE marks the whole list; ordinary CTEs and
`withScalar` aliases can share the clause and render unchanged. ClickHouse's own
requirements — `enable_analyzer`, a `UNION ALL` between the seed and the
recursive term, and `max_recursive_cte_evaluation_depth` — are documented rather
than validated.

`withCTE` and `withRecursiveCTE` accept `{ sql, parameters }` as a body.
Placeholders use ClickHouse's `{name:Type}` form and are matched by name, so a
raw body keeps its values out of the SQL text the way a builder body does. This
is the only way to write a recursive term, which references an alias no builder
can express. Values are still escaped client-side today; native `query_params`
will change the transport, not this API.

`db.withCTE(...)` and `db.withRecursiveCTE(...)` declare a CTE before the query
has a source, and the following `.table(alias)` reads from it with the declared
columns typing selects, filters, joins, and the result row. `.table()` also
accepts a schema table, which keeps schema typing and leaves the CTEs joinable.
Declarations are scoped to the queries started from that scope; nothing is added
to the schema. `FINAL` and `PREWHERE` are rejected on a CTE source, and `final()`
now rejects non-table sources at compile time as `prewhere()` already did.

Existing `withCTE` calls, inferred columns, and rendered SQL are unchanged.
