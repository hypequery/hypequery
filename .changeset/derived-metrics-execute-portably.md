---
"@hypequery/protocol": minor
"@hypequery/datasets": minor
---

Carry a derived metric's authored formula in the deployment contract, so derived
metrics execute portably instead of failing closed.

A derived metric's contract expression already stated what the metric means: it
inlines each input's aggregate where the formula named it. What it dropped were
the aliases. Those are not cosmetic — they become the column names of the
intermediate aggregate and are referenced by the outer select, so a catalog
rebuilt without them computes the same number through different SQL. Decision
0005 excludes a surface that cannot be made byte-identical, which is why
`CORE-12` refused derived metrics rather than approximating them.

`ProtocolDatasetMetric` gains an optional `derivation` carrying the inputs under
their aliases and the formula written in terms of them. It is additive: a
contract produced before this field stays valid, and simply remains
non-portable. Validation proves the two forms describe one formula —
substituting the inputs back into the authored form must reproduce the inlined
one exactly — so they cannot disagree silently. Inputs are ordered, not sorted,
because each becomes a column of the intermediate result in that order.

A derivation is also held to the grammar a formula can be rebuilt from, which is
narrower than RFC 0003: arithmetic over references and the five formula
functions, with a literal only as a `round` precision or a `coalesce` fallback.
Accepting a comparison, or a one-argument `round`, would publish a contract that
validates and then fails at the point of use. Eligibility follows the metric's
expression rather than its `kind`, because `kind` reports `grained-metric` for
both a base metric pinned to a grain and a derived one.

`rehydrateProtocolDatasets` rebuilds the formula by calling the same helpers in
`formulas.ts` that authored it, rather than compiling the expression to SQL a
second time. Those helpers carry the `toSQL` closures that decide spacing,
parenthesisation, and function spelling, so byte-identity is structural rather
than reimplemented and cannot drift.

The `CORE-16` equality harness now covers derived metrics across every axis it
already generated — grouping, all five grains, filters, ordering, pagination,
joins, and tenant predicates — over every formula helper, including a derived
metric pinned to a grain, whose `kind` reports `grained-metric` rather than
`derived-metric`. A metric whose contract omits the formula still fails closed
with `unsupported-capability`, in both rehydration and the portable executor.
