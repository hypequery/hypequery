# Portable expression v1 fixtures

This family accompanies accepted RFC 0003 and covers the closed semantic expression registry plus metric and dataset query envelopes.

`success.json` exercises accepted expressions and queries. `rejections.json` pins every stable failure code, including generated depth, width, node-count, and unsafe-accessor cases. Together they pin the exact protocol boundaries: depth 16/17, 1,000/1,001 nodes, and 100/101 collection items.

Each case contains exactly one literal `value` or deterministic `generator`. Each rejection also selects the `expression` or `query` validation surface.

Generators have these language-neutral meanings:

- `nested-not` wraps the literal expression `{ "kind": "literal", "value": false }` in exactly `depth` logical `not` nodes.
- `logical-operands` creates one logical `and` node containing `count` distinct copies of that literal expression.
- `logical-tree` creates a logical `and` root with ten logical `and` groups. The first nine groups contain 100 distinct literal expressions and the tenth contains `lastGroupItems`. The resulting expression has exactly `911 + lastGroupItems` nodes.
- `unsafe-accessor` is host-model conditional under RFC 0012 and exposes a reference's `name` through an accessor rather than a data property.

RFC 0023 added the null checks: the `comparison-isNull`, `comparison-isNotNull` and `null-check-*` success cases and the `dataset-null-check-filters` query, and rejections for a null check with a `right` operand (including a `null` literal), one without `left`, and a value comparison without `right`.

RFC 0025 added `having` and `timezone` to the query envelope: the `dataset-having-*`, `dataset-timezone-*` and `metric-timezone` queries, and the `having-*` and `timezone-*` rejections (a measure that isn't selected or with no `measures`, `like` and null-check operators, non-numeric and boolean values, wrong `between`/`in` shapes, an extra or missing member, `having` on a metric query, and a zone outside RFC 0018's registry or in the wrong case).

RFC 0029 runs the logical filters this grammar always accepted: the `dataset-logical-filters` query (and `logical-filters-with-segments` in `expressions-v2`) nests `and` inside `or` and `or` inside `not` beside a top-level comparison.

RFC 0029 added `inDateRange` and `fill`: the `dataset-in-date-range-*` queries (every grammar form, and a range under `not`), `dataset-fill` and `dataset-fill-false`, and the `in-date-range-*` and `fill-*` rejections (values outside the grammar, a non-literal value, the operator outside query filters or inside an aggregate's filters or `having`, `fill` without `by`, a non-boolean `fill`, and `fill` on a metric query). `expressions-v2` adds `fill-sub-day-relative-range`.
