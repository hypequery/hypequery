# Composite relationship equality keys

Dataset relationship declarations may use a non-empty `keys` array of physical
`{ from, to }` column pairs instead of the existing single `from` / `to` syntax.
The keys form an AND of ordinary column equalities. Source and target columns
must not repeat. Any NULL key component prevents a match.

Serialized relationship records retain the existing `from` and `to` fields as
the first pair and optionally include the complete `keys` array. When present,
`keys` MUST be non-empty, `keys[0]` MUST agree with the top-level pair, and all
pairs MUST contain unqualified physical column identifiers and pass safe-object
validation. Top-level `from` and `to` are also unqualified when `keys` is
present; legacy single-key records retain their existing identifier grammar. The array
is bounded by the deployment's `maxDatasetItems` limit. These rules apply to
local dataset contracts and deployment contracts. Existing single-key records
are serialized unchanged.

Consumers implementing this extension MUST use every pair. Consumers unable
to execute composite relationships MUST reject them rather than execute only
the compatibility pair. Older strict protocol validators reject the additional
field. The frozen TypeScript plan/backend implementation explicitly rejects
composite traversal; the canonical query-builder path supports it.

Runtime tenant predicates remain additional ON conditions and base tenant
scoping is unchanged. To-one joins retain single-match semantics. Target
uniqueness checks use the complete target tuple, excluding rows where any
component is NULL, within the checked tenant scope. HasMany remains metadata
only. This extension does not add range joins, OR predicates or raw SQL join
expressions.
