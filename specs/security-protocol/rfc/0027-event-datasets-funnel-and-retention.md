# RFC 0027: Event datasets, funnel and retention operations

- Status: Proposed
- Version: none (an additive dataset field in deployment contracts 2 and 3, and
  two operation kinds in semantic invocation 1)
- Extends: RFC 0003 (query envelope), RFC 0006 (deployment contract), RFC 0014
  (semantic invocation), RFC 0019 (visibility and enforced constraints), RFC
  0020 (row policies)

## Summary

A dataset can declare that its rows are events: one row per thing an entity
did, at the dataset's time key. A caller can then ask two questions a dataset
query cannot answer:

- **Funnel**: of the entities that did step 1, how many went on to do step 2,
  then step 3, within a window.
- **Retention**: of the entities that first did X in a period, how many came
  back to do Y in each later period.

Both are new operation kinds next to `dataset` and `metric`. They are separate
kinds, not dataset-query options, because their rows have fixed columns of
their own (`step`, `conversion_from_previous`, `cohort`, `rate`) rather than
the selected dimensions and measures. The same enforcement applies to them as
to dataset queries: endpoint access, tenancy, row policies, visibility,
enforced constraints and budgets.

## Motivation

hypequery Cloud's assistant cannot answer "where do users drop off between
signup and first query?" or "what share of March signups were still active in
June?". A dataset query can count each step separately, but per-step counts
are not a funnel. A funnel needs the same entity to reach step 1 and then
step 2 within a window, and a retention curve needs every entity tied to the
cohort it started in. Agents that try to build these from filtered counts
produce numbers that look plausible and are wrong.

ClickHouse already has the primitives (`windowFunnel`, per-entity arrays).
This RFC names the portable request and response so a gateway in any language
can pass the calls through, and pins the semantics so every executor returns
the same numbers.

The bar is a product-analytics funnel (PostHog, Amplitude). Cube's legacy
funnel extension is not the model.

## Event datasets (amends RFC 0006)

A dataset contract, and a dataset in deployment contracts 2 and 3, may
contain `events`:

```json
{
  "name": "activity",
  "source": "analytics.activity",
  "timeField": "occurredAt",
  "events": { "entity": "userId", "event": "eventName" },
  "dimensions": [ ... ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `entity` | yes | The dimension that identifies who did the event (`userId`, `accountId`). The default entity of every operation on the dataset. |
| `event` | no | The dimension that names what happened (`eventName`). Catalog metadata: it tells an agent which field step conditions usually test. |

The event timestamp is always the dataset's `timeField`. There is no separate
timestamp field, so an event dataset and its dataset queries agree on time.

Validation (`HQ_DEPLOYMENT_*`):

- `events` is a closed object. An unknown member fails with
  `HQ_DEPLOYMENT_UNKNOWN_FIELD`, a missing `entity` with `HQ_DEPLOYMENT_TYPE`.
- `entity` and `event` are simple identifiers naming dimensions of the same
  dataset. A name the dataset doesn't have fails with
  `HQ_DEPLOYMENT_INVALID_REFERENCE`.
- `entity` must be a groupable dimension of type `string` or `number`.
  `event` must be a filterable dimension of type `string`. Both fail with
  `HQ_DEPLOYMENT_INVALID_VALUE` otherwise.
- `timeField` must name one of the dataset's own `timestamp` dimensions. A
  dataset with `events` and no such time field fails with
  `HQ_DEPLOYMENT_INVALID_REFERENCE` at `events`.

`events` takes part in canonical bytes and deployment identity like any other
field. A peer that predates this RFC refuses a contract carrying it, because
datasets are closed records. Consumers upgrade together. They must not strip
the field or fall back.

Code-first datasets declare the same object, so publishing and rehydration
are identity:

```ts
const activity = dataset('activity', {
  source: 'analytics.activity',
  timeKey: 'occurredAt',
  events: { entity: 'userId', event: 'eventName' },
  dimensions: { ... },
});
```

## Operations (amends RFC 0014)

`operation.kind` in a semantic invocation may also be `funnel` or `retention`.
Both are accepted in semantic invocation version 1 only. They use no
expression extension 2 feature, so under the lowest-version rule a version 2
request that carries one fails with `HQ_INVOCATION_INVALID_VERSION`. Like
every operation, the record is closed and fails closed.

The operation validators reuse RFC 0003's `HQ_EXPRESSION_*` codes, and the
invocation wraps them as `HQ_INVOCATION_INVALID_VALUE` at `$.operation`, as it
does for dataset queries.

### Shared fields

| Field | Required | Rule |
| --- | --- | --- |
| `dataset` | yes | Simple identifier. The dataset must declare `events`. |
| `entity` | no | Simple identifier naming the dimension whose distinct values are counted. Defaults to `events.entity`. |
| `filters` | yes | RFC 0003 predicates, AND-combined, applied to every event before anything is counted. Must contain exactly one bounded range on the time field (see below). |
| `breakdown` | no | 1–3 distinct simple identifiers naming groupable dimensions. An empty array fails: omit the field instead. |
| `breakdownLimit` | no | Integer 1–100, default 25. Only valid with `breakdown`. |
| `timezone` | no | RFC 0025: an IANA name from the pinned registry. It moves bucket boundaries and the bounds of the time range. Absent means `UTC`. |

A **condition list** (`where`) is a non-empty array of at most 10 RFC 0003
predicates, AND-combined. It follows the same grammar as `filters`.

**The time range.** `filters` must contain exactly one bounded range on the
dataset's `timeField`: either one `between`, or one `gt`/`gte` together with
one `lt`/`lte`. The bounds are ISO 8601 date or timestamp strings. This is the
rule window measures already follow, and an RFC 0029 relative range resolves
to the same shape. The data plane refuses a missing, half-open or doubled
range with `input-invalid`. The span may be at most 731 days. Every event outside the range is ignored, including later steps and
returns, so a call never scans an unbounded table.

### Funnel

```json
{
  "kind": "funnel",
  "dataset": "activity",
  "steps": [
    { "name": "signed_up", "where": [
      { "kind": "comparison", "operator": "eq",
        "left": { "kind": "reference", "name": "eventName" },
        "right": { "kind": "literal", "value": "signup" } } ] },
    { "name": "first_query", "where": [
      { "kind": "comparison", "operator": "eq",
        "left": { "kind": "reference", "name": "eventName" },
        "right": { "kind": "literal", "value": "query_run" } } ] }
  ],
  "window": "7 day",
  "order": "strict",
  "filters": [
    { "kind": "comparison", "operator": "between",
      "left": { "kind": "reference", "name": "occurredAt" },
      "right": { "kind": "literal", "value": { "$hypequery": {
        "type": "tuple", "values": ["2026-10-01", "2026-11-01"] } } } }
  ],
  "breakdown": ["plan"]
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `steps` | yes | 2–10 steps. Each is exactly `{ name, where }`. `name` is a simple identifier, unique within the funnel. |
| `window` | yes | `"<N> <unit>"`: N is an integer from 1 with no leading zero, and unit is `second`, `minute`, `hour`, `day` or `week`, singular, with one space. The window may be at most 365 days. |
| `order` | no | `strict` (the default) or `any`. |
| `by` | no | `day`, `week` or `month`: a conversion trend by step-1 cohort. |

Plus the shared fields.

**Semantics.** Timestamps are compared at millisecond precision. An entity
*reaches step k* when, within the time range:

- `strict`: there are events e1 … ek where ei satisfies step i's conditions,
  each event is strictly later than the one before it, and
  `time(ek) − time(e1) ≤ window`. Other events may happen in between. Two
  events with the same timestamp never chain, so one event can't satisfy two
  consecutive steps.
- `any`: steps 1 … k each have at least one matching event, and all of those
  events fall within one span of length `window`, in any order. One event may
  satisfy more than one step.

Reaching step k implies reaching every earlier step, so the counts never
increase down the funnel. `any` is the costlier mode: executors may refuse it
with `budget-exceeded` on entities with very many events.

`strict` here means ordered. It is PostHog's "sequential" mode, not PostHog's
"strict" mode, which forbids other events between steps. That mode is not part
of this RFC.

**Breakdown.** The events are partitioned by the breakdown values, and the
funnel runs separately in each partition. An entity whose events carry more
than one value, such as a user seen in two countries, is counted in each
partition using only that partition's events. Use entity-level attributes
(`plan`, `signupCountry`) where attribution must be stable. Groups are ranked
by the number of entities reaching step 1 (descending), then by the breakdown
values (ascending, nulls last). Only the first `breakdownLimit` groups are
returned. A result with exactly `breakdownLimit` groups may have left groups
out.

**Trend (`by`).** Each entity (within a breakdown partition) belongs to the
cohort of the bucket that contains its first step-1 event in the range. The
funnel counts are reported per cohort. Buckets are the same as a dataset
query's `by` for that grain and zone.

**Rows.** For each cohort (ascending, when `by` is set), each returned
breakdown group (in rank order) and each step (ascending):

| Column | Value |
| --- | --- |
| `cohort` | Only with `by`: the bucket start as `YYYY-MM-DD`. |
| *each breakdown dimension* | That group's value, under the dimension's name. |
| `step` | The step `name`. |
| `step_index` | 1-based position. |
| `entities` | Entities that reached this step. |
| `conversion_from_previous` | `entities / previous step's entities`; for step 1, `1`. `null` when the denominator is 0. |
| `conversion_from_first` | `entities / step 1's entities`. `null` when step 1 has 0 entities. |
| `dropoff` | `previous step's entities − entities`; for step 1, `0`. |

Ratios are IEEE doubles and are not rounded. With neither `by` nor
`breakdown`, a funnel no entity entered still returns one row per step with
`entities: 0`. Otherwise a cohort or group with no step-1 entity has no rows.

### Retention

```json
{
  "kind": "retention",
  "dataset": "activity",
  "start": { "where": [
    { "kind": "comparison", "operator": "eq",
      "left": { "kind": "reference", "name": "eventName" },
      "right": { "kind": "literal", "value": "signup" } } ] },
  "return": { "where": [
    { "kind": "comparison", "operator": "eq",
      "left": { "kind": "reference", "name": "eventName" },
      "right": { "kind": "literal", "value": "query_run" } } ] },
  "grain": "week",
  "periods": 8,
  "filters": [ "…one bounded range on occurredAt…" ]
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `start` | yes | Exactly `{ where }`: what puts an entity into a cohort. |
| `return` | yes | Exactly `{ where }`: what counts as coming back. It may equal `start`. |
| `grain` | yes | `day`, `week` or `month`. |
| `periods` | yes | Integer 1–52. |

Plus the shared fields.

**Semantics.** An entity's *cohort* is the bucket (at `grain`, in the query
zone) of its first `start` event in the range. The entity is *retained in
period p* when it has at least one `return` event in the bucket `cohort + p`.
A return in the cohort bucket itself (period 0) never counts. Retention is
measured per bucket ("classic"), not as "returned in p or any later
period". With `breakdown`, events are partitioned exactly as for a funnel,
and groups are ranked by cohort size summed over all cohorts.

A period has a row only when its whole bucket ends no later than the range
end. A partly covered period would understate retention, so it is left out
rather than reported low. Align the range start to a bucket boundary too:
otherwise the first cohort's bucket is only partly covered, and the cohort is
smaller than it should be.

**Rows.** For each returned breakdown group (in rank order), each cohort
(ascending) and each fully covered period 1 … `periods` (ascending):

| Column | Value |
| --- | --- |
| *each breakdown dimension* | That group's value. |
| `cohort` | The cohort bucket start as `YYYY-MM-DD`. |
| `period` | The offset in buckets, 1 … `periods`. |
| `entities` | The cohort's size. |
| `retained` | Entities in the cohort that were retained in this period. |
| `rate` | `retained / entities`. |

### Reserved output names

A breakdown dimension may not share a name with a fixed column of its
operation: `cohort`, `step`, `step_index`, `entities`,
`conversion_from_previous`, `conversion_from_first`, `dropoff` for a funnel,
and `cohort`, `period`, `entities`, `retained`, `rate` for retention. This
fails with `HQ_EXPRESSION_INVALID_QUERY`, so a row never has two values for one
key.

## Enforcement (amends decision 0002 and RFC 0014)

A data plane runs the same sequence for a funnel or retention call as for a
dataset query: pinning, target resolution (`operation.dataset`), the endpoint
policy, authentication, visibility, access, tenant, enforced constraints,
budgets, input validation, execution and output bounds. In addition, it
refuses with `input-invalid` when:

- the dataset declares no `events`;
- `entity` or a breakdown dimension isn't groupable, isn't visible to the
  caller (RFC 0019), or is a time dimension;
- a step, start or return condition, or a filter, is not a plain
  `field <operator> literal` comparison on a filterable, visible field of the
  dataset with an operator that field allows (the rule dataset-query filters
  follow), or a condition names the time field (the range belongs in
  `filters`). A relationship-qualified field is refused;
- the time range rule above is broken;
- `filters`, every condition in every `where`, and the enforced constraints
  together exceed the dataset's `maxFilters`;
- the estimated row count exceeds the effective row budget. For a funnel it
  is `(by ? buckets : 1) × (breakdown ? breakdownLimit : 1) × steps`, and for
  retention it is `buckets × periods × (breakdown ? breakdownLimit : 1)`.
  Buckets are estimated from the range span in UTC, rounded up. The caller
  narrows the range, grain or `breakdownLimit`, and is told so.

A hidden field fails exactly like an unknown one. Tenant, row-policy and
constraint predicates apply to the event scan before any per-entity
computation, so an entity is reconstructed only from rows the caller may read.
An executor binds every caller value as a parameter and never inlines one.

An executor that can't run an operation kind refuses it with
`unsupported-capability`. It never approximates one with dataset queries. The
TypeScript data plane takes a separate, optional `executeEventOperation`
executor, so an executor written for dataset queries never receives a funnel.
Without one, the data plane refuses event operations with
`unsupported-capability` (`HQ_SEMANTIC_UNSUPPORTED_OPERATION`).

## Result (RFC 0014)

Results use the existing `hypequery-semantic-invocation-result` record. Rows
are flat scalars and `meta.rowCount` equals the number of rows. There is no
pagination: the row bound above, not paging, keeps results small.

## Cache preimage (RFC 0013)

Neither operation has a portable cache key in this RFC. A preimage builder
only accepts `dataset` and `metric` queries, so a funnel or retention call is
never served from, or written to, a portable result cache. This is the rule
`having` already follows (RFC 0025).

## Limits

| Limit | Maximum |
| --- | ---: |
| Funnel steps | 10 (minimum 2) |
| Conditions per `where` | 10 (minimum 1) |
| Breakdown dimensions | 3 |
| `breakdownLimit` | 100 |
| Funnel window | 365 days |
| Retention `periods` | 52 |
| Time range span | 731 days |

Products may lower but not raise these.

## Conformance (RFC 0012)

- `event-operations-v1` (new family, codes `HQ_EXPRESSION_*`): accepted and
  rejected funnel and retention operations.
- `semantic-invocations-v1`: invocations carrying each kind, and the version 2
  rejection.
- `deployments-v2` and `deployments-v3`: datasets with `events`, and every
  rejection above.

Python announces `deployments-v2` and `deployments-v3`, so its contract
validator accepts `events` in the same change that adds those cases. Python
validates neither semantic invocations nor event operations, so the new
family stays TypeScript-only until the Python data plane lands.

## Compatibility

Everything is additive: every contract and invocation valid before this RFC
is still valid and means the same thing. An older peer refuses a contract with
`events` or an invocation with a new kind, because both records are closed. A
new caller talking to an old executor therefore gets an error, never a wrong
number.

## Alternatives considered

- **Funnel options on a dataset query.** These were rejected because the rows
  don't have a dataset query's shape. A `dimensions`/`measures` envelope
  carrying `steps` would invite combinations (`having`, `orderBy`, measures)
  that have no meaning.
- **Funnel and retention as measures.** These were rejected because a measure
  is one number per group. A funnel is N related numbers per group, and its
  ratios depend on each other.
- **`windowFunnel` over the raw rows.** Its `strict_increase` mode gives a
  wrong level when an entity has events with equal timestamps: the order it
  processes ties in decides whether a chain survives. The reference executor
  splits each event into one row per step it satisfies, orders the rows by
  `time × (N + 1) + (N − step)`, and scales the window by `N + 1`. That keeps
  `windowFunnel` and makes ties deterministic. It is checked against a
  brute-force search over generated event sets.
- **An explicit `timeRange` field.** This was rejected so that the range has
  one encoding, the one window measures and relative dates already use.

## Follow-ups

- Python: code-first `events`, rehydration, funnel and retention planning, and
  the data plane, in that order.
- Cross-dataset funnels: an RFC 0028 SQL-sourced dataset that unions several
  activity tables is an event dataset like any other.
- "Recurring" (p or later) retention, attribution modes for breakdowns,
  PostHog-style no-intervening-event funnels, and exclusion steps.
