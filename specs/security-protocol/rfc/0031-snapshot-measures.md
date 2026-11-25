# RFC 0031: Snapshot (semi-additive) measures

- Status: Proposed
- Version: none (one new measure kind in deployment contract 3)
- Extends: RFC 0006 (deployment contract), RFC 0015 (deployment contract 3,
  time measures), RFC 0030 (contract 3 feature registry)

## Summary

Some tables hold a level, not an event: a headcount, an account balance, an
inventory count, a subscription's seats. Each row records the state of one
entity at one time. Those values add up across entities, but not across time.
Two months of a unit's headcount are not twice as many people.

This RFC adds a **snapshot measure**. It wraps a base measure and names the
entity key. For each entity, it takes the rows at that entity's latest time
(or earliest) within each result period, and then aggregates those rows with
the wrapped measure:

```json
{ "name": "headcount", "kind": "snapshot", "measure": "headcountRows",
  "per": ["unitId"], "pick": "last" }
```

It is a new kind in the contract `measures` array, beside `derived`, `window`
and `shift`, so it forces deployment contract 3. A consumer that doesn't know
the kind refuses the contract. It never reads the measure as a plain sum.

## Motivation

hypequery Cloud's assistant drafted a model over
`org_unit_headcount(unit_id, month, headcount)`, with one headcount level per
unit per month. It had no way to say "latest per unit, then sum", so it drafted
one of two measures, and both give wrong numbers:

| Unit | Jan | Feb |
| --- | ---: | ---: |
| u1 | 10 | 12 |
| u2 | 5 | 6 |
| u3 | 7 | (closed) |

| Measure | Total, no time dimension | Right answer |
| --- | ---: | ---: |
| `sum(headcount)` | 40: counts every month | 25 |
| `argMax(headcount, month)` | 12 or 6: one row at the latest month, chosen arbitrarily on the tie | 25 |
| snapshot, `per: ["unitId"]` | 12 + 6 + 7 = 25 | 25 |

`argMax` is correct only when the query groups by `unit_id`. As a single
total it returns one unit's headcount. `sum` is correct only when the query
groups by `month`. The model should give the right total whatever the caller
groups by, so the measure has to carry the rule. A query-time option would
leave every agent to remember it.

Other semantic layers have the same concept: MetricFlow's
`non_additive_dimension` with `window_groupings`, and SSAS/Power BI
`LastNonEmpty`.

## Definition (amends RFC 0006 and RFC 0015)

A contract 3 dataset's `measures` may contain:

```json
{
  "name": "headcount",
  "kind": "snapshot",
  "measure": "headcountRows",
  "per": ["unitId"],
  "pick": "last",
  "label": "Headcount",
  "description": "People per unit at the end of the period, summed across units."
}
```

| Field | Rule |
| --- | --- |
| `kind` | `"snapshot"`. |
| `measure` | A base measure of the same dataset, of any aggregation except `merge`. It can't be a derived, window, shift or snapshot measure. A merge measure's rows are partial states for a time bucket, not levels, so this version leaves them out. |
| `per` | The entity key: distinct dimension names of the dataset, at most 8, possibly empty. It can't include the time field, an alternate time field or a relationship-qualified name. |
| `pick` | `"last"` (closing value) or `"first"` (opening value). |
| `approximate` | Present, and `true`, exactly when the wrapped measure is approximate (RFC 0015). |
| `label`, `description`, semantic metadata | As for every measure. |

The dataset must declare `timeField`. The snapshot is taken on that field.
Validation failures use the existing codes at the offending field:
`HQ_DEPLOYMENT_INVALID_REFERENCE` for an unknown or wrongly kinded `measure`,
or an unknown, time or qualified `per` entry. `HQ_DEPLOYMENT_INVALID_VALUE`
covers a bad `pick`, a duplicate or over-long `per`, a `merge` input, a wrong
`approximate` marker, or a missing `timeField`.

Contract 2 has no snapshot kind. A producer emits contract 3 for a dataset that
declares one, under the lowest-version rule, and a contract 2 validator rejects
the record. RFC 0030's feature registry gains `snapshotMeasures`, after
`alternateTimeFields`. A deployment target that doesn't list it in `accepts`
refuses the deployment.

The wrapped base measure stays an ordinary measure. Selected on its own,
`headcountRows` is the plain sum. That is correct within one snapshot time
(grouped by `month`) and wrong across several.

## Semantics

Let a query select dimensions *D*, optionally a grain `by`, and a snapshot
measure *S* that wraps base measure *M* with entity key *E*. Let the time
field be *t*.

1. **Population.** Start from the dataset rows that pass the row scope
   (tenant and row policies, RFC 0020), enforced constraints (RFC 0019), and
   the query's **time predicates**. A time predicate is a top-level query
   filter, or a comparison inside a top-level `and`, whose field is *t*. The
   same rule picks out a window measure's range (RFC 0015), and an RFC 0029
   `inDateRange` resolves to one. Rows whose *t* is NULL never take part.
2. **Pick.** Partition the population by the period bucket of *t* (when `by`
   is present) and by *E*. In each partition, keep every row whose *t* equals
   the partition's maximum (`last`) or minimum (`first`). Ties are all kept.
   NULL is one key value, as in SQL `PARTITION BY`. With `per: []`, each
   partition is the whole bucket, so the pick keeps the rows at the bucket's
   latest time, whichever entities they belong to.
3. **Narrow.** Apply every other query filter, the selected segments, and
   *M*'s own fixed filters to the picked rows. These predicates narrow the
   snapshot. They don't choose it.
4. **Aggregate.** Group the remaining rows by *D* (and the period) and
   aggregate them with *M*.

The partition never includes *D*. Each entity therefore contributes one
snapshot per period, and *D* is read from that snapshot. When a unit moves
from EU to US in February, a January–February query grouped by region counts
it under US only. The region groups then add up to the total. If *D* were in
the partition, the unit would also count under EU with its stale January row.
For the same reason, a query may not select *t* itself as a plain dimension
next to a snapshot measure, or any dimension whose SQL dependencies include
*t*'s column. That query fails with `input-invalid` and should use `by`. A
query that selects an alternate time key (RFC 0029 `timeKey`) with a snapshot
measure fails the same way.

### With and without a time dimension

Using the table above, with `per: ["unitId"]`:

| Query | Result |
| --- | --- |
| No `by`, no range | 25: each unit's latest row (u1 Feb, u2 Feb, u3 Jan) |
| `by: "month"` | Jan 22, Feb 18. u3 has no February row, so it is not in the February bucket. |
| `by: "quarter"` | Q1 25 |
| No `by`, `month` ≤ Jan 31 | 22 ("as of 31 January") |
| `dimensions: ["unitId"]` | One row per unit with its latest headcount, as `argMax` gives |

With `per: []`, the same queries give 18, Jan 22 and Feb 18, Q1 18, 22, and
one row each for u1 and u2 (12 and 6). The closed unit drops out because it
has no row at the latest time.

The two keys give different answers on purpose:

- **`per: [entity]`** carries each entity's last known value to the end of
  the window. Use it when entities report on their own schedules, such as
  account balances that are written only when they change.
- **`per: []`** reads the population at the window's last time. Use it when
  every live entity reports at every time, and a missing row means the entity
  is gone.

A snapshot measure needs no `by` and no time range. Without a range, the
window is all time. With `fill` (RFC 0029), a filled bucket has no rows: the
measure reports NULL, or 0 when *M* is a `count`, as for other measures.
Values never carry forward from one bucket to the next. A bucket without rows
for an entity doesn't count that entity.

### Composition

| Use | Rule |
| --- | --- |
| Derived measure `uses` | Allowed: the formula reads the snapshot's output column. |
| Window or shift over a snapshot | Rejected in this version (they wrap base measures only, RFC 0015). |
| Snapshot over a measure with relationship filters | Allowed. The filters narrow the picked rows through the guarded to-one join. |
| Relationship measure `<relationship>.<snapshot>` | Rejected: not a base measure. |
| Dataset metric over a snapshot | Refused when publishing: the expression grammar has no snapshot aggregate. |
| RFC 0026 calculations | `formula` and `rank` may read the output. `filter`, `shift`, `window`, `compare` and `share` with a snapshot input fail with `input-invalid` in this version. |
| `having`, `orderBy` | As for any measure. |

## Reference ClickHouse lowering (non-normative)

The headcount model in `@hypequery/datasets`:

```ts
const OrgUnitHeadcount = dataset('org_unit_headcount', {
  source: 'org_unit_headcount',
  timeKey: 'month',
  dimensions: {
    unitId: dimension.string({ column: 'unit_id' }),
    month: dimension.timestamp(),
    region: dimension.string(),
  },
  measures: {
    headcountRows: measure.sum('headcount'),
    headcount: measure.snapshot('headcountRows', { per: ['unitId'] }), // pick: 'last'
  },
});
```

For the query `{ dimensions: ['region'], measures: ['headcount'], by:
'quarter', filters: [month between 2026-01-01 and 2026-06-30, region = 'EU'] }`:

```sql
WITH _hq_rows AS (
  -- Population: row scope and time predicates only.
  SELECT toStartOfQuarter(org_unit_headcount.month) AS _hq_period,
         org_unit_headcount.unit_id AS _hq_e0,
         org_unit_headcount.month AS _hq_time,
         org_unit_headcount.region AS _hq_d0,
         org_unit_headcount.headcount AS _hq_v0
  FROM org_unit_headcount
  WHERE org_unit_headcount.month BETWEEN {lower} AND {upper}
    AND isNotNull(org_unit_headcount.month)
),
_hq_snapshot AS (
  -- Pick: each unit's latest month in each quarter; ties kept.
  SELECT *, max(_hq_time) OVER (PARTITION BY _hq_period, _hq_e0) AS _hq_pick
  FROM _hq_rows
)
SELECT _hq_period AS `period`, _hq_d0 AS `region`, sum(_hq_v0) AS `headcount`
FROM _hq_snapshot
WHERE _hq_time = _hq_pick
  AND _hq_d0 = {region}        -- Narrow: other filters apply to the snapshot.
GROUP BY `period`, `region`
ORDER BY `period` ASC
```

`pick: "first"` uses `min`. Without `by`, the partition is `_hq_e0` alone. With
`per: []`, the partition is `_hq_period` alone, and without `by` it is
`max(_hq_time) OVER ()`. A semi-join gives the same result:
`(_hq_period, _hq_e0, _hq_time) IN (SELECT _hq_period, _hq_e0, max(_hq_time)
FROM _hq_rows GROUP BY _hq_period, _hq_e0)`. A planner may use it on engines
without window functions, or when it scans less. *M*'s fixed filters are
rendered inside the aggregate, `sum(if(<filter>, _hq_v0, 0))`, as for every
base measure. A relationship field in a filter is joined in `_hq_rows`.

A query that also selects ordinary measures computes them from the fully
filtered rows, as today. It joins the snapshot aggregate onto the same group
keys, the way the time-measure planner joins each window measure's
per-measure aggregate. A group that has ordinary rows and no snapshot rows
reports the snapshot measure as NULL (or 0 for a `count`), and the reverse
also holds. Each distinct (`per`, `pick`) pair needs its own pick CTE.

## Validation in consumers

Beyond the contract rules above, an executor refuses the following with
`input-invalid` and a message naming the measure:

- a snapshot measure beside the time field as a plain dimension, or beside a
  dimension whose SQL dependencies include the time field's column;
- a snapshot measure with an alternate `timeKey`;
- the composition cases marked "rejected" above.

An executor that can't plan a snapshot measure must refuse with
`unsupported-capability`. It must never fall back to the wrapped measure. Until
they implement this RFC, the frozen semantic backend plan and the portable
executor refuse it.

## Hashing and compatibility

- Every contract that declares no snapshot measure keeps the same bytes, the
  same version under the lowest-version rule, and the same identity. Nothing
  is added to existing records.
- A contract that declares one is contract 3, and the snapshot record is part
  of its canonical bytes and identity like any measure. Changing `per` or
  `pick` changes the identity, so it invalidates RFC 0013 cache keys derived
  from it.
- Older contract 3 consumers reject the unknown measure kind through the
  closed record and do not run the deployment. This covers Python before it
  adopts the RFC, the portable executor, and deployment targets that don't
  accept `snapshotMeasures`. A new producer talking to an old consumer gets an
  error, never a wrong number.
- The semantic invocation is unchanged. A query selects a snapshot measure by
  name, so it needs no new invocation version.
- In `@hypequery/protocol`, `ProtocolDeploymentMeasureV3` gains
  `ProtocolDatasetSnapshotMeasure`. Widening that output union breaks
  consumers that switch exhaustively on `kind`. The changeset must say so in
  its `Consumer-breaking:` line, and API reports change.

## Catalog and client contract

Catalog entries (agent catalog, RFC 0018 client contract) for a snapshot
measure carry `kind: "snapshot"`, `per` and `pick`. An agent can then tell
that the measure is semi-additive and that its time series has no carry-over
between buckets. The wrapped measure's entry is unchanged.

## Authoring API (non-normative)

- TypeScript: `measure.snapshot(baseMeasure, { per, pick = 'last', label,
  description })`, beside `measure.cumulative` and `measure.shift`.
  `buildProtocolDatasetContract` (contract 2) refuses a dataset with one by
  name, as it does window measures.
- Python: `snapshot(base_measure, per=(...), pick="last")`, mirroring the
  TypeScript model (decision 0023).

## Conformance (RFC 0012)

- `deployments-v3`: a success case for the headcount model, with canonical
  bytes and identity, for `pick: "first"` and for `per: []`. Rejection cases for
  every validation rule above. A contract 2 case that carries a snapshot
  record and fails.
- `target-acceptance-v1` (RFC 0030): `contract-3-features.json` gains a dataset
  that forces contract 3 only through a snapshot measure, and the
  every-feature dataset gains one.
- An execution corpus against ClickHouse over the table above, extended with
  ties at the latest time, NULL times, a NULL entity key, a unit that changes
  region, a fixed filter that differs between a unit's months (`status =
  'open'`), `pick: "first"`, `fill`, a mix with an ordinary measure, and every
  row of the "with and without a time dimension" table. Each case is pinned
  against brute-force SQL over the same rows.
- TypeScript and Python contract validators pass the same vectors. Python adds
  the cases when its validator accepts the kind, in the same change, because
  it announces `deployments-v3`.

## Alternatives considered

- **`argMax(value, time)`.** This is the measure Cloud drafted. It keeps one
  row overall, not one per entity, so its total is one entity's value, and the
  row it keeps on a tie is arbitrary.
- **A modifier on base measures** (`nonAdditive: { per, pick }`, as MetricFlow
  does). Rejected because every consumer of base measures would read the
  modified measure as a plain aggregate until it is updated. That includes
  relationship measures, windows, shifts, metric expressions, the portable
  executor and older contract 3 peers. They would return the wrong number
  without an error. A new kind is refused by everything that doesn't know it.
- **A general nested aggregate** (`sum` over `argMax` per entity). More
  general, because it also covers "average orders per customer". But it
  exposes tie handling and time semantics to every author, and it doesn't
  define what happens per bucket. Non-time two-stage aggregation belongs with
  fan-out-safe aggregation (RFC 0017).
- **A query-scoped calculation** (an RFC 0026 kind). Rejected: whether a
  measure is semi-additive is a fact about the data, not a choice the caller
  makes. A model that is only right when the caller remembers an option gives
  agents wrong answers.
- **Filters applied before the pick.** This is plain `WHERE` semantics. It
  answers "the latest EU row of every unit that was ever in EU", so a unit
  that moved to the US still counts its stale EU headcount. A fixed filter
  `status = 'open'` would count a closed unit at its last open month. Only
  the row scope, enforced constraints and the time window define the
  population. The row scope must, because a row outside it may never affect a
  result.
- **Partitioning by the selected dimensions too.** Rejected because a group
  could count an entity's stale snapshot, as above, and the groups would no
  longer add up to the total.
- **An explicit time field on the measure.** Deferred. With one time axis per
  query, the snapshot, the `by` buckets and the range can't disagree.

## Open questions

1. **Hiding the wrapped measure.** `headcountRows` remains selectable and is
   wrong across months. Should a base measure be able to be marked
   wrap-only, so it is published for its wrappers but not listed or
   selectable? That would be a separate, model-level visibility flag. RFC
   0019 visibility is per principal.
2. **Carry-forward across buckets.** An as-of balance per day, from rows
   written only on change, needs each entity's last value carried into later
   buckets. A bounded `carryForward: <interval>` with a required time range
   could follow the window measure rules. Deferred.
3. **Shift over a snapshot.** "Headcount a year ago" is a natural question.
   Allowing a shift to wrap a snapshot, with the snapshot taken in the
   shifted bucket, looks well defined. Deferred to keep RFC 0015's
   wrap-a-base-measure rule unchanged in this version.

## Feature coverage (amends RFC 0003)

| Datasets feature | Portable representation or boundary |
| --- | --- |
| Semi-additive (snapshot, balance, level) measures | Contract 3 `snapshot` measure kind (`measure`, `per`, `pick`) |
