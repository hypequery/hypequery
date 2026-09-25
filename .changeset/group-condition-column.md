---
"@hypequery/clickhouse": patch
---

Group a condition's column so a trusted SQL expression cannot widen the
predicates beside it.

A dataset dimension may be backed by SQL its author wrote during a build, and
the semantic layer passes that expression into the column slot of a `where`.
The tenant predicate is a separate `where` on the same query, so the two are
joined with `AND`. Rendered without grouping, an expression containing a
top-level `OR` rebound across that `AND`: a dimension of `active OR is_public`
produced `tenant_id = ? AND active OR is_public = ?`, and because `AND` binds
tighter than `OR`, the second branch matched rows belonging to every tenant.

`groupConditionColumn` now wraps such an expression into one operand and
terminates a trailing line comment, which unterminated would swallow the rest
of the statement — the tenant predicate included. An ordinary column is
unchanged, so no existing SQL moves.

The package already applied both rules to `raw` expression nodes; this extends
them to the column slot of a condition, which is the path the semantic layer
uses.
