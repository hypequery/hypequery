# RFC 0015: Dataset vocabulary extension 2

- Status: Accepted
- Accepted: 2026-09-26
- Version: expression extension 2, deployment contract 3
- Amends: RFC 0003 (expression extension 1), RFC 0006 (deployment contract 2)
- Tracking: HQ-77, HQ-78, HQ-79, HQ-83, HQ-86

Acceptance freezes expression extension 2 and deployment contract 3.
Implementations may not claim conformance to either until the fixtures listed
under [Conformance plan](#conformance-plan) exist and pass.

## Summary

Expression extension 1 and deployment contract 2 have closed registries: five
time grains, eleven aggregations, no reusable named predicates, and measures
addressed only by simple identifier. Six gaps from the datasets roadmap cannot
cross the portable boundary without changing them:

1. **Sub-day grains.** `hour` and `minute` time buckets.
2. **Approximate distinct counts.** An `approxCountDistinct` aggregation that
   trades exactness for bounded memory on high-cardinality columns.
3. **Segments.** Named, author-defined predicates on a dataset that a query
   selects by name, such as `enterprise` or `activeLast30Days`.
4. **Relationship measures.** Selecting a measure declared on a to-one
   relationship target, such as `customer.customerCount`, from the base
   dataset.
5. **Rolling and cumulative measures.** A trailing window, month-to-date, or
   running total over a base measure (HQ-78).
6. **Period-over-period measures.** A base measure evaluated over an earlier
   period, such as the same bucket one year before (HQ-79).

Contract 3 also renames the dataset `filters` allow-list to `allowedFilters`
(HQ-86). Once datasets carry segments, three different things are called
filters, and only one of them is a permission list.

This RFC defines them as expression extension 2 and deployment contract 3.
Expression extension 2 is a strict superset of extension 1. Contract 3 changes
the dataset allow-list field from `filters` to `allowedFilters`, so a contract 2
envelope is not valid merely by changing its version to 3. Consumers of
contract 3 MUST continue accepting version 2 envelopes with their original
meaning; producers retain version 2 for deployments that use no new feature.

## Goals

- Keep every existing artifact byte-identical, and so hash-identical, unless it
  uses a new feature.
- Keep security properties unchanged. Segments carry no SQL, and a caller can
  select a segment but never define one.
- Leave the query envelope open to the rolling-window and period-comparison work
  (HQ-78, HQ-79) without spending a version number on this RFC's decisions.

## Non-goals

- Timezone-aware bucketing, custom intervals such as 15 minutes, and week-start
  configuration. Buckets follow the same timezone rule as extension 1 grains.
- Relationship-qualified segment predicates and segments that reference other
  segments.
- Multi-hop relationship measures, measures across `hasMany`, and derived
  measures whose inputs span datasets.
- Measure `filters` that reference segments.
- Query-level comparison options, such as Cube's `compareDateRange`. Windows
  and shifts are declared as measures, so every consumer sees them as ordinary
  measure columns.

## Versioning and selection

An expression envelope does not carry its own version. Its containing artifact
selects it, as RFC 0003 already requires:

| Container | Expression extension |
| --- | --- |
| Deployment contract 2 | 1 |
| Deployment contract 3 | 2 |
| Semantic invocation 1 (RFC 0014) | 1 |
| Semantic invocation 2 | 2 |

A contract 3 envelope has `kind: "hypequery-deployment"` and `version: 3`. Its
identity uses the domain prefix `hypequery:deployment:v3\0`. Semantic
invocation 2 differs from version 1 only in validating `operation` under
expression extension 2.

Window and shift measures change only the contract. A query selects them by
simple measure name, exactly like any other measure, so they do not by
themselves require semantic invocation 2.

**Lowest-version rule.** A producer MUST emit deployment contract 2 when no
dataset uses a grain, aggregation, segment, or measure kind introduced here,
and contract 3 otherwise. A contract 3 envelope always uses `allowedFilters`;
the rename alone never forces contract 3. Version selection is then deterministic from content, and an
upgraded producer does not change the identity of a deployment that does not
use the new features. The same rule applies to semantic invocations. A request
that names no new grain and no segment is invocation 1.

A consumer that supports only the earlier versions rejects the new container
version and does not partially execute it (decision 0001). A consumer that
supports the new versions MUST keep accepting the earlier ones.

## Time grains

The grain registry becomes `minute`, `hour`, `day`, `week`, `month`,
`quarter`, and `year`. The new grains are valid wherever a grain is valid:
query `by`, metric `grain`/`grains`, and dataset `defaults`.

A grain bucket is identified by its start instant. For `minute` and `hour`, the
period value in a result is the bucket start at second precision, in the form
`YYYY-MM-DD HH:MM:SS`, the same form a ClickHouse `DateTime` takes in JSON. The
bucket is computed in the timezone that extension 1 grains use for the same
column. This RFC does not add timezone selection.

A consumer that knows the physical type of the time column MUST reject `minute`
and `hour` on a column without a time-of-day component, such as ClickHouse
`Date` or `Date32`. Bucketing one would put every row at midnight, which reads
as a real answer. A consumer that cannot see the physical type MAY execute.

Reference ClickHouse lowering: `toStartOfMinute(column)` and
`toStartOfHour(column)`.

Sub-day grains can produce many rows. They add no new limit. The dataset and
endpoint result ceilings already bound every response.

## Approximate distinct count

The aggregate registry gains `approxCountDistinct`, with `field` and optional
`filters`. `argField` and `level` are forbidden, as for `countDistinct`. An
empty `filters` array is valid.

The result estimates the number of distinct non-NULL values of `field`. It is
not a lower or upper bound, and two executions over the same data MAY return
different values. An implementation MAY compute the count exactly. This keeps
the in-memory and test backends simple and conforming. An implementation MUST
NOT lower `countDistinct` to an approximate algorithm.

Reference ClickHouse lowering: `uniq(field)`. With filters, the extension 1
filtered-aggregate rule applies: `uniqIf(field, predicate)` or the equivalent
NULL-wrapping form.

`approxCountDistinct` is valid in derived-measure formulas like any other base
aggregation. A derived measure whose inputs include an approximate measure is
itself approximate.

### Catalog and contract metadata

A measure's contract entry and catalog entries (including the agent-safe
projection) MUST expose `approximate: true` when its aggregation is
`approxCountDistinct`, or when it is a derived measure with an approximate
input. The field is absent otherwise, so extension 1 entries are unchanged. An
agent that reports the value MUST be able to tell the reader it is an
estimate.

## Segments

A segment is a named predicate that the dataset author declares. It lets a
consumer ask for a business-defined population by name without learning, or
being allowed to construct, the predicate behind it.

### Contract shape

A contract 3 dataset may carry `segments`, an array of closed objects:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Simple identifier, unique within the dataset's segments |
| `predicate` | yes | Expression extension 2 predicate |
| `label`, `description` | no | Bounded text, as for other named items |
| semantic metadata | no | The RFC 0006 semantic metadata fields |

Segment names live in their own namespace. A segment named `status` does not
collide with a dimension `status`.

The predicate:

- MUST be a predicate as defined by RFC 0003: a `comparison` or a `logical`
  tree whose leaves are all comparisons. Each comparison operand MUST be a
  `reference` or a `literal`. Arithmetic, calls, and aggregates are not
  allowed.
- MUST reference only the dataset's own dimensions, by simple identifier. It
  MUST NOT use relationship-qualified references, measures, or aggregates.
- MUST NOT reference the dataset's tenant field. Tenant scope is applied by
  trusted runtime context, never by authored predicates.
- MAY reference a dimension that is not in the dataset's `filters`. That is the
  purpose of a segment: an author can publish a named cut of the data without
  giving callers an open filter on the column. Filter exposure governs what a
  caller may construct. It does not restrict what an author may declare.
- Is validated with RFC 0003 limits, with its own node budget per segment.

Validation fails with `HQ_DEPLOYMENT_INVALID_VALUE` at the offending path when
a predicate reference does not name a dimension on the dataset, or names the
tenant field. An expression-shape failure also reports
`HQ_DEPLOYMENT_INVALID_VALUE` at the predicate, just as contract 2 reports a malformed
measure filter.

### Query shape

Dataset and metric queries gain an optional `segments` array of simple
identifiers. Each entry MUST be unique. The collection obeys the 100-item
limit.

A consumer resolves each name against the target dataset's segments and rejects
an unknown name as it rejects an unknown dimension. The effective row predicate
is the AND of the tenant predicate, every selected segment's predicate, and the
query `filters`. Order within `segments` does not change the result.
Implementations MUST NOT rely on order, and canonical encoding preserves it as
authored.

Segments apply to base rows before aggregation, exactly as query filters do.
They do not affect measure `filters`.

### Catalog and agent-safe projection

The catalog lists each segment's `name`, `label`, and `description`. The
agent-safe projection MUST NOT include the predicate. Its literals can reveal
thresholds or identifiers that the author did not choose to publish, and an
agent needs only the name and description to select it. The full contract keeps
the predicate, because execution needs it.

### Caching

The query envelope carries segment names, and the deployment identity covers
their definitions. RFC 0013 cache keys therefore change when either changes,
with no new cache-key rule.

## Relationship measures

Extension 1 lets a query reach a to-one target's dimensions but not its
measures. Extension 2 allows query `measures` entries of the form
`<relationship>.<measure>`, under the same one-hop, to-one rules as qualified
dimensions. The measure is computed over the target rows reached from the
queried base rows. Base rows are selected by the tenant predicate, segments,
and filters. They are joined as in extension 1 and grouped by the query's
dimensions. The target measure's own `filters` apply to the joined target
columns.

This is the target population *as seen through the base*. `customer.customerCount`
grouped by order status counts the customers with orders in each status, not
every customer. Customers with no orders never appear. A consumer that wants
the target's own population queries the target dataset.

### Duplicate sensitivity

A `belongsTo` join repeats one target row for every base row that references
it. An aggregate that is sensitive to duplicate inputs would count that target
row once per base row. `sum` of a customer's credit limit over their five
orders reports five times the limit. The protocol therefore constrains which
aggregations may be selected through each relationship kind:

| Target aggregation | Through `belongsTo` | Through `hasOne` |
| --- | --- | --- |
| `countDistinct`, `approxCountDistinct`, `min`, `max`, `argMax`, `argMin` | allowed | allowed |
| `sum`, `count`, `avg`, `percentile`, `stddev`, `variance` | rejected | allowed |
| Derived measure | rejected | rejected |

`hasOne` places the key on the target and is declared one-to-one, so each
target row joins at most one base row and no aggregation is inflated. As with
every relationship, the declaration is trusted. Implementations SHOULD offer
a data check equivalent to `@hypequery/datasets`' `checkRelationships`.

Envelope validation only checks that each entry is a qualified identifier.
The rule is applied by the consumer when it resolves references against the
contract, where an unknown measure is already rejected, and its message names
the relationship kind and the aggregation.
Symmetric-aggregate lowering, which would make `sum` safe across `belongsTo`,
is HQ-81's subject and is out of scope here.

Derived relationship measures are rejected in extension 2 because their inputs
may mix duplicate-sensitive and duplicate-insensitive aggregations.

### Contract and catalog

The deployment contract needs no new field. A qualified measure is resolvable
from the base dataset's relationships and the target's measures, and the
queryability rule above is a pure function of the relationship kind and the
target aggregation. Catalogs SHOULD list the resulting selectable qualified
measure names beside the qualified dimension names they already list, so an
agent does not need to derive the rule.

A target measure whose `approximate` marker is set remains approximate when
selected through a relationship.

## Renamed filter allow-list

In contract 3, the dataset field `filters` is renamed `allowedFilters`. Its
items, validation, limits, and meaning are unchanged: each names a dimension a
caller may filter on and, optionally, the operators allowed. Contract 3
rejects `filters` at dataset level as an unknown field.

After this RFC, a dataset carries three kinds of predicate: segment predicates,
measure `filters`, and query `filters`. The allow-list is none of these. It
governs what a caller may construct. The new name keeps an author from
mistaking it for a predicate applied to rows. Measure `filters` and query
`filters` keep their names, because they are predicates.

The authoring API is out of scope. `@hypequery/datasets` keeps its `filters`
option and maps it to `allowedFilters` when producing contract 3.

## Time windows and period shifts

Windows (HQ-78) and shifts (HQ-79) are new measure kinds in the contract
`measures` array, beside base and derived measures. Each wraps one base
measure of the same dataset. It cannot wrap a derived, window, or shift
measure. The query selects them by name like any measure. A derived measure's
`uses` may reference window and shift measures, so growth rates are ordinary
formulas:

```json
{ "name": "revenuePriorYear", "kind": "shift", "measure": "revenue",
  "interval": { "amount": 1, "unit": "year" } }
{ "name": "revenueGrowth", "kind": "derived",
  "uses": [{ "alias": "now", "measure": "revenue" },
           { "alias": "before", "measure": "revenuePriorYear" }],
  "expression": { "kind": "binary", "operator": "divide",
    "left": { "kind": "binary", "operator": "subtract",
      "left": { "kind": "reference", "name": "now" },
      "right": { "kind": "reference", "name": "before" } },
    "right": { "kind": "reference", "name": "before" } } }
```

An interval is `{ "amount": <positive safe integer>, "unit": <grain> }` using
the grain registry. Both kinds require the dataset to declare a time field. A
window or shift measure is not selectable through a relationship, because its
time axis belongs to the dataset that declares it.

### Time axis requirements

A query that selects a window or shift measure MUST:

- carry `by`, the grain of its buckets, and
- bound the dataset time field with exactly one range: `between`, or a lower
  bound (`gt`/`gte`) together with an upper bound (`lt`/`lte`). The range can
  be a top-level query filter or the only child of a top-level `and`.

The range defines the output **series**: every bucket of the grain that
intersects it. A consumer MUST reject a query whose series would exceed its
effective result limit before executing it. Missing buckets are filled. Every
series bucket appears once for each combination of the other selected
dimensions that occurs in the scanned rows. A filled bucket reports base
measures as NULL and counts as 0. Window and shift measures are computed for
filled buckets like any other.

Gap filling is required, not optional, because it is what makes windows
well defined. Without it, "the last seven rows" and "the last seven days"
diverge on sparse data. With it they coincide whenever the window is a whole
number of buckets, which the rules below require.

### Windows

A window measure has `kind: "window"`, `measure`, and exactly one of:

| Field | Value at bucket *b* aggregates base rows with time in |
| --- | --- |
| `trailing: <interval>` | [end(*b*) − interval, end(*b*)) |
| `toDate: <grain>` | [start of the `toDate` period containing *b*, end(*b*)) |
| `cumulative: true` | (−∞, end(*b*)) |

Bucket ends are exclusive. For example, a daily bucket ending at midnight
includes rows at the preceding midnight and excludes rows at its ending
midnight, which belong to the next bucket.

The value is a **re-aggregation of base rows**, not a combination of bucket
values. A 7-day trailing `countDistinct` of users counts each user once across
the seven days. Segments, query filters other than the time range, tenant
scope, and the base measure's own filters all apply to the rows being
aggregated. The time range bounds only the output series. Rows before the range
still feed the windows of its first buckets.

Rules:

- `trailing` MUST be a whole number of query-grain buckets. The interval unit
  equals the grain, or converts exactly: `hour` = 60 `minute`, `day` = 24
  `hour`, `week` = 7 `day`, `quarter` = 3 `month`, `year` = 4 `quarter` = 12
  `month`. Otherwise the query is rejected. Consumers MUST NOT round.
- `toDate` MUST name a grain strictly coarser than the query grain, and that
  grain's periods must be whole numbers of query buckets. `week` is not a whole
  number of `month` buckets, so `toDate: "month"` with `by: "week"` is
  rejected.
- A single row may contribute to at most 1,000 buckets. That bounds trailing
  length divided by grain, and a `toDate` period divided by grain. Longer
  windows are rejected.
- `cumulative` is allowed only over `sum`, `count`, `min`, and `max`. These
  can be computed as a running total of bucket partials plus one aggregate
  over rows before the range. Cumulative distinct counts, averages, and
  percentiles need unbounded state per bucket and are left to a later
  extension.

Reference ClickHouse lowering, non-normative: for `trailing` and `toDate`,
expand each scanned row into the bounded set of buckets whose window contains
it (`arrayJoin` over bucket offsets), then aggregate by bucket. This
re-aggregates rows with any aggregation and needs no range join. For
`cumulative`, use `sum(...) OVER (ORDER BY period ROWS UNBOUNDED PRECEDING)` over
bucket partials, seeded with the pre-range aggregate. Fill with `WITH FILL` or a
generated series.

### Shifts

A shift measure has `kind: "shift"`, `measure`, and `interval`. Its value at
bucket *b* is the base measure over [start(*b*) − interval, end(*b*) − interval).
Subtraction is calendar arithmetic. Month, quarter, and year shifts clamp to
the last day of the month, so 31 March minus one month is 28 or 29 February.
Clamping can map two buckets onto one earlier period. That is accepted and
matches ClickHouse `subtractMonths`.

The interval MUST be a whole number of query-grain buckets under the same
conversion table as `trailing`. For example, a 1-year shift is valid with
`month`, `quarter`, or `year` grains, and a 1-month shift is invalid with
`week`. This keeps shifted buckets aligned with real buckets, so a comparison
never mixes partial periods.

Rows are selected by segments, non-time filters, tenant scope, and the base
measure's filters, exactly as for the unshifted measure. Only the time window
moves.

Reference ClickHouse lowering, non-normative: aggregate the base measure over
the range shifted back by the interval, bucket it, relabel each bucket by
adding the interval back, and LEFT JOIN it onto the filled series.

### Approximation and catalog

A window or shift over an approximate measure is approximate. The contract and
catalog entry for a window or shift measure MUST carry its kind and parameters,
and `requiresTimeRange: true`, so an agent can see before calling that the
query needs `by` and a range. React and OpenAPI consumers need nothing new.
These are measure columns, typed like any other measure, and the filled series
is ordinary rows.

## Failure codes

No new codes are needed. `HQ_EXPRESSION_INVALID_AGGREGATION` covers a malformed
`approxCountDistinct`. `HQ_EXPRESSION_INVALID_QUERY` covers a malformed or
duplicate `segments` entry and an unknown grain. Deployment failures use the
existing `HQ_DEPLOYMENT_*` codes. Contract failures for window and shift
measures report `HQ_DEPLOYMENT_INVALID_VALUE` at the offending field.
Query-time failures of the time-axis rules are consumer rejections, like an
unknown measure, and name the rule that failed. Validation order follows RFC 0003: `segments`
is checked in document position after `filters` and before `orderBy`.

## Dataset feature coverage additions

| Datasets feature | Portable representation or boundary |
| --- | --- |
| `minute` and `hour` grains | Grain registry; `by`, metric grains, defaults |
| `measure.approxCountDistinct` | `aggregate` node with `approxCountDistinct` |
| Approximate-result marker | Contract and catalog `approximate` |
| Named segments | Contract `segments`; query `segments` |
| Relationship measures | Qualified `measures` entries; kind/aggregation rule |
| Rolling, to-date, and cumulative measures | Contract `window` measures |
| Period-over-period measures | Contract `shift` measures; derived measures for deltas and ratios |
| Filter allow-list | Contract `allowedFilters` (renamed from `filters`) |

## Conformance plan

Conformance claims require, in addition to this document:

- `expressions-v2` fixtures: every extension 1 case replayed unchanged, the new
  grains, `approxCountDistinct` with and without filters, the forbidden
  `argField`/`level` cases, `segments` item-limit and duplicate boundaries, and
  qualified `measures` identifiers.
- `deployments-v3` fixtures: canonical bytes and identities, segment predicate
  shape failures, references to unknown and tenant dimensions, the
  `approximate` marker on base and derived measures, window and shift measure
  shapes (including `cumulative` over a disallowed aggregation), `allowedFilters` accepted and
  `filters` rejected, and a contract 2 case showing that the lowest-version
  rule leaves its identity unchanged.
- An execution corpus against ClickHouse for windows, to-date, cumulative, and
  shifts on sparse series. It also covers the query-time rules: each
  interval-conversion boundary, the 1,000-bucket bound, and the time-range
  requirement. It must include filled buckets, lookback before the
  range, and end-of-month clamping.
- `semantic-invocations-v2` fixtures for `segments`, sub-day `by`, and
  qualified measures.
- The TypeScript reference implementation in `@hypequery/protocol` and the
  Python implementation passing the same fixtures.
- `@hypequery/datasets` authoring, catalog, and execution support, including
  the physical-type check for sub-day grains where schema introspection is
  available.

## Resolved questions

1. **Accuracy parameter for `approxCountDistinct`.** None. ClickHouse offers
   several sketches (`uniq`, `uniqCombined(precision)`, `uniqHLL12`) with
   different accuracy/memory trade-offs. A portable `precision` field would bind
   every implementation to one sketch family's parameter scale, which is
   meaningless to an exact or non-ClickHouse implementation. Callers who need a
   specific sketch keep the trusted SQL measure escape hatch.
2. **Segments in measure filters.** Deferred. A measure such as
   `enterpriseRevenue` could filter by `segment: enterprise` instead of
   repeating the predicate. However, editing the segment would then silently
   change the measure's meaning. It would also make measure validation depend
   on segment resolution order. Authors repeat the predicate for now.
3. **HQ-86 rename.** Done in contract 3, as `allowedFilters`, so it does not
   need a contract 4.
