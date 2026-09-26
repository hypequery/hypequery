# RFC 0015: Dataset vocabulary extension 2

- Status: Draft
- Version: expression extension 2, deployment contract 3
- Amends: RFC 0003 (expression extension 1), RFC 0006 (deployment contract 2)
- Tracking: HQ-77 and HQ-83 (this RFC's implementation), HQ-78 and HQ-79 (reserved below)

This is a draft. Nothing in it is frozen, and no implementation may claim
expression extension 2 or deployment contract 3 conformance until it is
accepted with fixtures.

## Summary

Expression extension 1 and deployment contract 2 have closed registries: five
time grains, eleven aggregations, no reusable named predicates, and measures
addressed only by simple identifier. Four gaps from the datasets roadmap cannot
cross the portable boundary without changing them:

1. **Sub-day grains.** `hour` and `minute` time buckets.
2. **Approximate distinct counts.** An `approxCountDistinct` aggregation that
   trades exactness for bounded memory on high-cardinality columns.
3. **Segments.** Named, author-defined predicates on a dataset that a query
   selects by name, such as `enterprise` or `activeLast30Days`.
4. **Relationship measures.** Selecting a measure declared on a to-one
   relationship target, such as `customer.customerCount`, from the base
   dataset.

This RFC defines them as expression extension 2 and deployment contract 3.
Both are strict supersets: every valid extension 1 document and contract 2
envelope is valid under the new versions and keeps its meaning.

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
- Rolling, cumulative, and period-over-period calculations. See
  [Reserved for successor work](#reserved-for-successor-work).

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

**Lowest-version rule.** A producer MUST emit deployment contract 2 when no
dataset uses a grain, aggregation, or segment introduced here, and contract 3
otherwise. Version selection is then deterministic from content, and an
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
  tree whose leaves are all comparisons.
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
tenant field. The expression-shape failures keep their `HQ_EXPRESSION_*` codes,
as embedded expressions already do.

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

## Failure codes

No new codes are needed. `HQ_EXPRESSION_INVALID_AGGREGATION` covers a malformed
`approxCountDistinct`. `HQ_EXPRESSION_INVALID_QUERY` covers a malformed or
duplicate `segments` entry and an unknown grain. Deployment failures use the
existing `HQ_DEPLOYMENT_*` codes. Validation order follows RFC 0003: `segments`
is checked in document position after `filters` and before `orderBy`.

## Dataset feature coverage additions

| Datasets feature | Portable representation or boundary |
| --- | --- |
| `minute` and `hour` grains | Grain registry; `by`, metric grains, defaults |
| `measure.approxCountDistinct` | `aggregate` node with `approxCountDistinct` |
| Approximate-result marker | Contract and catalog `approximate` |
| Named segments | Contract `segments`; query `segments` |
| Relationship measures | Qualified `measures` entries; kind/aggregation rule |

## Reserved for successor work

HQ-78 (rolling and cumulative calculations) and HQ-79 (period-over-period
comparisons) both compute a value for one time bucket from other buckets. They
are deliberately **not** part of extension 2, but its shape is chosen so that
they can be added as extension 3 without reinterpreting anything here:

- Both need a time axis, which is a grain plus the dataset time field. Neither
  is expressible without `by`, so their validation can require a grain
  from the same registry this RFC extends.
- Both are best expressed as query-level or derived-measure constructs over an
  already-aggregated series, not as new `aggregate` kinds. A window over an
  aggregate is not an aggregate of rows, and folding it into the aggregate
  registry would let it appear in positions, such as aggregate filters, where it
  has no meaning.
- ClickHouse `RANGE` window frames over `DateTime` require numeric offsets and
  do not fill missing buckets. Whether portable rolling windows count buckets or
  elapsed time must be decided before either feature is specified, because the
  two give different answers on sparse series.

## Conformance plan

Acceptance requires, in addition to this document:

- `expressions-v2` fixtures: every extension 1 case replayed unchanged, the new
  grains, `approxCountDistinct` with and without filters, the forbidden
  `argField`/`level` cases, `segments` item-limit and duplicate boundaries, and
  qualified `measures` identifiers.
- `deployments-v3` fixtures: canonical bytes and identities, segment predicate
  shape failures, references to unknown and tenant dimensions, the
  `approximate` marker on base and derived measures, and a contract 2 case
  showing that the lowest-version rule leaves its identity unchanged.
- `semantic-invocations-v2` fixtures for `segments`, sub-day `by`, and
  qualified measures.
- The TypeScript reference implementation in `@hypequery/protocol` and the
  Python implementation passing the same fixtures.
- `@hypequery/datasets` authoring, catalog, and execution support, including
  the physical-type check for sub-day grains where schema introspection is
  available.

## Open questions

1. Should `approxCountDistinct` accept an accuracy parameter, such as
   `uniqCombined`'s precision? This draft says no. A parameter is a new field
   that every implementation must honor, and exact computation already conforms.
2. Should segments be allowed in measure `filters`? It would let a measure such
   as `enterpriseRevenue` reuse a segment, but it couples measure identity to
   segment definitions. Deferred.
3. HQ-86 proposes renaming the dataset `filters` allow-list once segments exist.
   A rename is a contract field change and would need contract 3 or later.
   Deciding it now would avoid a contract 4.
