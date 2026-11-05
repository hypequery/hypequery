# RFC 0025: `having` and `timezone` in semantic queries

- Status: Proposed
- Version: none (additive fields in expression extensions 1 and 2)

A portable semantic query can filter on aggregated measure values (`having`)
and choose the zone its time buckets use (`timezone`). The in-process dataset
client has offered both since HQ-329, and so have the MCP `query_dataset` tool
and RFC 0018 client contracts. The portable query had neither, so a host that
executes through the semantic data plane could not run them. It had two
choices, both bad. It could refuse the call, so an agent following a published
tool schema hit an error. Or it could drop the fields, so a `having` returned
every group and a zone was ignored. Dropping silently returns wrong numbers.

## Query envelope (RFC 0003)

A dataset query may contain `having`. A dataset or metric query may contain
`timezone`. Both are accepted under expression extensions 1 and 2. A metric
query with `having` fails with `HQ_EXPRESSION_UNKNOWN_FIELD`, as `measures`
does.

### `having`

An array of conditions, AND-combined, applied after grouping:

```json
{
  "kind": "dataset",
  "dataset": "orders",
  "dimensions": ["status"],
  "measures": ["revenue", "orders"],
  "having": [
    { "measure": "revenue", "operator": "gt", "value": 1000 },
    { "measure": "orders", "operator": "between", "value": [1, 5] }
  ]
}
```

Each condition has exactly `measure`, `operator` and `value`. An extra member
fails with `HQ_EXPRESSION_UNKNOWN_FIELD`, and a missing one with
`HQ_EXPRESSION_TYPE`. The following fail with `HQ_EXPRESSION_INVALID_QUERY`:

- `measure` is not one of the query's `measures`, including any condition in a
  query with no `measures`. `measure` is parsed like `measures`: simple under
  extension 1, qualified one-hop under extension 2.
- `operator` is outside `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`
  and `notIn`. `like` and the RFC 0023 null checks have no meaning on a number.
- A value is not a finite JSON number. Booleans and numeric strings are not
  numbers.
- `between` doesn't have exactly two values, or `in`/`notIn` has an empty
  list.

`having` follows the array rules of every other query collection, and an
empty array asks for nothing. It sits after `filters` (and `segments`) in
document order.

Requiring the measure in `measures`, rather than allowing any measure the
dataset publishes, means a query never filters on a value it doesn't return.
It also means a caller that may not see a measure can't name it in `having`:
it fails as the selection fails.

### `timezone`

An IANA zone name from RFC 0018's pinned registry
(`fixtures/client-contract-v1/timezone-names.txt`), matched exactly. A name
outside the registry, including a different case, fails with
`HQ_EXPRESSION_INVALID_QUERY`. A non-string fails with `HQ_EXPRESSION_TYPE`.
Host ICU or zoneinfo acceptance must not decide validity, so every
implementation accepts the same queries.

The zone moves time-grain buckets (`by`) and the bounds of time-key filters.
It is allowed without `by`, for the filter bounds. Absent means `UTC`. It sits
after `by` in document order.

## Execution (RFC 0014)

An executor applies `having` after grouping and before the row limit. It binds
values as parameters and never inlines them. A deployment data plane also
checks the following, failing with `input-invalid`:

- Each condition's measure is selected and visible to the caller (RFC 0019).
  Because `measure` must be in `measures`, a hidden measure fails exactly as
  selecting it does, with the same message.
- `filters` plus `having` conditions stay within the dataset's `maxFilters`,
  after any enforced constraints (RFC 0019). This matches the dataset client
  and RFC 0018's shared `maxPredicates`.
- A `timezone` on a dataset with no visible time field is refused. It would
  change nothing, and silently ignoring it would hide a mistake.

An executor that can't run either field must refuse the call with
`unsupported-capability`. It must never drop the field.

## Cache preimage (RFC 0009)

The preimage's normalized query is unchanged, and no existing preimage or key
moves:

- **A non-empty `having` has no portable key.** Building a preimage for such a
  query fails with `HQ_CACHE_PREIMAGE_INVALID_QUERY`. This is the rule TS and
  Python result caches already follow: they run `having` queries uncached.
- **A `timezone` other than `UTC` has no portable key either.** It fails the
  same way. A caller folds a non-UTC zone into the definition identity, as both
  languages already do (`hypequery.ts.cache-timezone.v1`), and builds the
  preimage without it. `"UTC"` is accepted and normalizes as if absent, because
  UTC is the default and folds nothing.

Refusing, rather than leaving the fields out of the preimage, means a query
that uses either can never share a key with one that doesn't.

## Conformance (RFC 0012)

New cases in existing families; no new family and no gate change:

- `expressions-v1/success.json` `/queries`: `dataset-having-operators`,
  `dataset-having-every-comparison`, `dataset-having-empty`,
  `dataset-timezone-with-grain`, `dataset-timezone-without-grain` and
  `metric-timezone`.
- `expressions-v1/rejections.json`: the `having-*` and `timezone-*` cases,
  which pin every failure above.
- `expressions-v2/success.json`: `having-relationship-measure` (a qualified
  measure, an `hour` grain and a zone).
- `cache-preimages-v1/rejections.json`: `query-having-uncacheable` and
  `query-timezone-not-folded`. `success.json`: `timezone-utc-is-default`,
  whose preimage is byte-identical to `all-dataset-features`.

## Compatibility

Both fields are optional, so every query valid before this RFC is valid and
means the same thing. A peer that predates this RFC refuses a query carrying
either field, because the query envelope is closed
(`HQ_EXPRESSION_UNKNOWN_FIELD`). A new caller talking to an old executor
therefore gets an error, never a silently wrong answer.

## Feature coverage (amends RFC 0003)

| Datasets feature | Portable representation or boundary |
| --- | --- |
| `having` conditions on selected measures | Query envelope `having` |
| Query timezone for grains and time-key bounds | Query envelope `timezone` |
