# RFC 0029: Boolean filters, relative date ranges, filled series and selectable time keys

- Status: Proposed
- Version: none (additive query fields and one operator in expression
  extensions 1 and 2; one optional contract 3 dataset field)

Four gaps stop an agent from answering ordinary analysis questions through the
semantic data plane, and each one either fails or answers wrongly:

1. **Boolean filters.** RFC 0003 has accepted `logical` `and`, `or` and `not`
   predicates in a query's `filters` since expression extension 1, but no
   executor runs them. The portable executor refuses every filter that is not
   a single comparison (`HQ_PORTABLE_QUERY_FILTER_NOT_COMPARISON`), and the
   in-process dataset client only takes a flat AND list. "Orders from the US
   or Canada that are not refunds" can't be asked.
2. **Relative dates.** "Last 30 days" has to be turned into two timestamps by
   the caller. An agent computes them from its own idea of today, in its own
   zone, and the answer drifts at every day boundary.
3. **Missing periods.** A plain `by` query returns no row for a period with no
   data, so a chart or an average over periods silently skips it. Window and
   shift queries already return every period; plain ones don't.
4. **Alternate time axes.** A dataset's `timeKeys` let a local query bucket by
   `shipped_at` instead of `created_at`, but publishing keeps only `timeKey`
   (`timeField`) and drops the rest without a word. A deployed query can't
   choose its axis, and nothing says why.

This RFC closes all four. Every field is optional, so a query or contract that
uses none of them is byte-identical to before.

## 1. Boolean filters

### Query envelope (RFC 0003)

The grammar is unchanged. A query filter is a predicate: a comparison, or a
`logical` node over predicates. `and` and `or` take two or more `operands`;
`not` takes one `operand`. The top-level `filters` array is an implicit `and`.

```json
{
  "kind": "dataset",
  "dataset": "orders",
  "measures": ["revenue"],
  "filters": [
    {
      "kind": "logical",
      "operator": "or",
      "operands": [
        { "kind": "comparison", "operator": "eq", "left": { "kind": "reference", "name": "country" }, "right": { "kind": "literal", "value": "US" } },
        { "kind": "comparison", "operator": "eq", "left": { "kind": "reference", "name": "country" }, "right": { "kind": "literal", "value": "CA" } }
      ]
    },
    {
      "kind": "logical",
      "operator": "not",
      "operand": { "kind": "comparison", "operator": "eq", "left": { "kind": "reference", "name": "status" }, "right": { "kind": "literal", "value": "refunded" } }
    }
  ]
}
```

What an executor can run is narrower than the grammar. Every leaf of a filter
must be a comparison of a `reference` with a `literal` (or a null check on a
`reference`, RFC 0023), exactly as a top-level filter must be today. A leaf
that compares two references, or an arithmetic or aggregate operand, fails
with `input-invalid`. The expression limits (RFC 0003 depth, node and item
counts) bound nesting.

### Effective operators

A dataset filter's `operators` list narrows what a caller may do with a field
(RFC 0024). `not` must not get around it: `not (status eq "x")` is
`status neq "x"`. A data plane therefore checks each leaf against the
allowlist with its **effective operator**, the operator it has after `not` is
pushed down to the leaves (negation normal form):

| Leaf | Under an odd number of `not`s |
| --- | --- |
| `eq` / `neq` | `neq` / `eq` |
| `gt` / `gte` / `lt` / `lte` | `lte` / `lt` / `gte` / `gt` |
| `in` / `notIn` | `notIn` / `in` |
| `isNull` / `isNotNull` | `isNotNull` / `isNull` |
| `between` | `lt` and `gt` (both must be allowed) |
| `like` | `like` (there is no portable `notLike`; a filter that allows pattern matching allows its negation) |
| `inDateRange` (§2) | `lt` and `gte` |

`not` over `and`/`or` swaps them (De Morgan). Every rewrite is exact under SQL
three-valued logic: a NULL field fails the predicate and its negation alike,
so `not` never starts matching NULL rows. An executor may render the original
tree or its negation normal form; the rows are the same.

The filter budget counts leaves. `maxFilters` (dataset limit, endpoint ceiling
and RFC 0018 `maxPredicates`) bounds the number of comparison leaves across
`filters`, plus `having` conditions as before. A logical node costs nothing,
so wrapping comparisons in `and` can't buy budget.

### What a caller's `or` cannot widen

Tenant predicates, enforced constraints (RFC 0019), row policies (RFC 0020)
and selected segments are ANDed with the caller's filters at the top level.
They are never operands of a caller's `or` or `not`. An `or` can widen only
what the caller itself narrowed.

Two existing refusals now apply per leaf, wherever the leaf sits: a filter on
the tenant key under runtime tenancy, and a filter on a field the caller may
not see (RFC 0019). A hidden field inside an `or` fails as an unknown field,
with the same message, so the tree doesn't reveal that it exists.

### Time-axis ranges

A window or shift query (RFC 0015), and a filled query (§3), needs exactly one
bounded range on its time axis. Only top-level comparisons, including those
inside a top-level `and`, count toward that range. A comparison on the time
axis inside an `or` or `not` filters rows but bounds nothing, and such a query
fails with `input-invalid`, as a query with no range does today.

### Cache preimage (RFC 0009)

Unchanged. A logical filter is part of the normalized query as validated.
Top-level filters are deduplicated and sorted as before. Operands inside a
logical node keep their order, so `or(a, b)` and `or(b, a)` have different
keys. They return the same rows, and the only cost is a cache miss.

### Dataset client

`DatasetQuery.filters` (and `MetricQuery.filters`) accept nested groups beside
flat comparisons. The flat list keeps its meaning (AND) and its SQL:

```ts
filters: [
  { or: [
    { field: 'country', operator: 'eq', value: 'US' },
    { field: 'country', operator: 'eq', value: 'CA' },
  ] },
  { not: { field: 'status', operator: 'eq', value: 'refunded' } },
]
```

A group is exactly one of `{ and: [...] }`, `{ or: [...] }` or `{ not: node }`.
An empty `and`/`or` is refused, and a one-item `and`/`or` means its item. Each
leaf is validated as a top-level filter is: its field, its effective operator
and its value. Groups need the queryBuilder execution path. The deprecated
`createBackend` path refuses them rather than flattening them.

## 2. Relative date ranges

### Operator

`inDateRange` is a comparison operator whose `right` is a string literal from
a fixed grammar:

```json
{ "kind": "comparison", "operator": "inDateRange", "left": { "kind": "reference", "name": "created_at" }, "right": { "kind": "literal", "value": "last 30 days" } }
```

It is accepted only in a semantic query's `filters`, at any depth, under
expression extensions 1 and 2. A measure's fixed `filters`, a segment
`predicate` and a `having` condition refuse it with
`HQ_EXPRESSION_INVALID_OPERATOR`. Those are stored definitions and must not
change meaning with the calendar. A `right` that is not a string in the
grammar fails with `HQ_EXPRESSION_INVALID_VALUE`.

The grammar is lowercase ASCII words separated by single spaces:

| Value | Range (half-open, in local dates) |
| --- | --- |
| `today` | `[T, T+1 day)` |
| `yesterday` | `[T-1 day, T)` |
| `this <unit>` | `[S, S+1 unit)` |
| `last <unit>` | `[S-1 unit, S)` |
| `last <N> <unit>` or `last <N> <unit>s` | `[S-N units, S)` |
| `month to date`, `quarter to date`, `year to date` | `[S, T+1 day)` |

`<unit>` is `day`, `week`, `month`, `quarter` or `year`. `<N>` is an integer
from 1 to 9999 written without leading zeros. Both `last 1 month` and
`last 3 month` are valid, as are `last 1 months` and `last 3 months`. `T` is
today's date and `S` is the first day of the unit containing `T`, so for
`day`, `S = T`.

The current period is defined the way Cube defines it:

- `this <unit>` **includes** the current period, all of it, including days
  that haven't happened yet.
- `last <unit>` and `last N <unit>s` **exclude** the current period. They are
  whole periods ending at `S`. `last 7 days` is the seven days before today
  and does not include today. `last 3 months`, asked on 2026-11-22, is
  2026-08-01 to 2026-11-01.
- `<unit> to date` includes the current period up to and including today.

Weeks start on the day the `week` grain truncates to, so a `this week` range
is always exactly one `week` bucket. Under this version that is Sunday (see
the Monday-weeks note in `utils/clickhouse-dataset-sql-dialect.ts`). If weeks
ever move to Monday, both change together. Quarters are calendar quarters
starting in January, April, July and October.

### Resolution

The executor resolves every `inDateRange` once per query, before validation,
caching and planning, as follows:

1. Read the executor's clock once. Every `inDateRange` in the query uses that
   instant. A caller's clock never decides the range, because the request has
   no field for it.
2. Take today's date `T` in the query zone (`timezone`, RFC 0025; absent means
   UTC).
3. Apply the table, giving local dates `[start, end)`.
4. Replace the comparison with `field gte start` and `field lt end`, written
   as `YYYY-MM-DD` dates. Under `not`, the replacement is
   `field lt start or field gte end`.

`inDateRange` must name a time axis of the dataset: its `timeField`, or one of
its `alternateTimeFields` (§4). Locally, that means `timeKey` or `timeKeys`.
Comparisons on a time axis are already read in the query zone (RFC 0025), so
`start` and `end` are local midnights in that zone. Daylight-saving changes
make a local day 23 or 25 hours long, never a different day. An `inDateRange`
on another field, including a relationship-qualified one, fails with
`input-invalid`. It is allowed only where the field's filter allows both `gte`
and `lt`, its effective operators. A dataset filter's `operators` list can't
name `inDateRange` (`HQ_DEPLOYMENT_INVALID_VALUE`): it isn't a capability of
its own, so no contract's filter surface or identity changes.

A resolved range is a top-level `gte`/`lt` pair, so a top-level `inDateRange`
on the query's time axis is the bounded range a window, shift or filled query
needs. A cache key is built from the resolved dates, so a cached "today" can't
answer tomorrow.

### Cache preimage (RFC 0009)

A query with an `inDateRange` anywhere in its filters has no portable key:
building a preimage fails with `HQ_CACHE_PREIMAGE_INVALID_QUERY`. A caller
that caches resolves the range first and keys the absolute query, as the
dataset client does.

### Dataset client

```ts
{ field: 'created_at', operator: 'inDateRange', value: 'last 30 days' }
```

The client resolves the range with `Date.now()` by default. The `now` option
of `createDatasetClient` replaces that clock for tests and replays. This is
unrelated to the `DateRangeValue` type in `@hypequery/clickhouse`'s legacy
`dataset/types.ts`, which nothing executes.

## 3. Filled series

### Query envelope (RFC 0003)

A dataset query may carry `fill`, a boolean:

```json
{
  "kind": "dataset",
  "dataset": "orders",
  "dimensions": ["country"],
  "measures": ["orders", "revenue"],
  "by": "day",
  "fill": true,
  "filters": [
    { "kind": "comparison", "operator": "inDateRange", "left": { "kind": "reference", "name": "created_at" }, "right": { "kind": "literal", "value": "last 30 days" } }
  ]
}
```

`fill` without `by` fails with `HQ_EXPRESSION_INVALID_QUERY`. A non-boolean
fails with `HQ_EXPRESSION_TYPE`. `fill: false` means the same as absent. A
metric query refuses `fill` with `HQ_EXPRESSION_UNKNOWN_FIELD`, as it refuses
`having`. The field sits after `timezone` in document order.

### Execution

A filled query returns the series a window query returns:

- one row per `by` period from the period holding the range's start to the
  period holding its end (inclusive or exclusive as the range bound is), in
  the query zone;
- times every combination of the selected dimensions that has rows anywhere
  in the scanned range;
- count measures (`count`, `countDistinct`, `approxCountDistinct`) are `0` in
  an empty period, and every other measure is `null`.

An empty period of a `sum` is `null`, not `0`, because there were no values
to add. A caller that wants zero coalesces.

`fill: true` needs exactly the bounded time range a window measure needs: one
top-level `between`, a top-level lower and upper bound, or a top-level
`inDateRange` on the query's time axis. Without one, the query fails with
`input-invalid`. The data plane never invents a range. The number of periods
is bounded by the effective row limit exactly as a window series is, and an
over-long series fails before scanning. `having` with `fill: true` is refused,
since it would delete the rows `fill` adds, as `having` on a window query is.
`fill` needs the queryBuilder path.

### Cache preimage (RFC 0009)

`fill: true` has no portable key (`HQ_CACHE_PREIMAGE_INVALID_QUERY`).
`fill: false` normalizes as if absent.

## 4. Selectable time keys

### Deployment contract 3 (RFC 0015)

A contract 3 dataset may carry `alternateTimeFields`: a non-empty array of
simple identifiers naming further time axes. It sits after `timeField` in
document order.

```json
{ "timeField": "created_at", "alternateTimeFields": ["shipped_at", "delivered_at"] }
```

Each entry must name a `timestamp` dimension of the dataset. Entries must be
distinct and must differ from `timeField`, and `timeField` must be present.
Any other value fails with `HQ_DEPLOYMENT_INVALID_REFERENCE`. Order is the
authored order and is part of the contract identity. The field is a contract 3
feature under the lowest-version rule. A dataset with `timeKeys` publishes
contract 3 and its `timeKeys` as `alternateTimeFields`, so they are never
silently dropped. A deployment without them keeps its bytes and identity.

### Query envelope (RFC 0003)

A dataset or metric query may carry `timeKey`, a simple identifier:

```json
{ "kind": "dataset", "dataset": "orders", "measures": ["orders"], "by": "week", "timeKey": "shipped_at",
  "filters": [{ "kind": "comparison", "operator": "inDateRange", "left": { "kind": "reference", "name": "shipped_at" }, "right": { "kind": "literal", "value": "this quarter" } }] }
```

It selects the time axis for `by`, `fill`, window and shift measures. The
query runs as if the dataset's `timeField` were the selected key. Absent
means `timeField`. A data plane refuses a `timeKey` that is neither
`timeField` nor one of `alternateTimeFields`, or whose dimension the caller
may not see (RFC 0019), with `input-invalid`. A hidden key reads exactly like
an unknown one. The field sits after `by` in document order, before
`timezone`.

### Cache preimage (RFC 0009)

A query carrying `timeKey` has no portable key
(`HQ_CACHE_PREIMAGE_INVALID_QUERY`). The preimage can't tell a key equal to
`timeField` from another without the contract.

## Execution (RFC 0014)

A data plane that can't run any of these must refuse the call with
`unsupported-capability`. It must never drop a field, flatten a group, or
widen a range. Every refusal above that isn't a grammar failure is
`input-invalid` with a message naming the field, so an agent can correct
itself in one round trip.

## Conformance (RFC 0012)

New cases in existing families, with no new family and no gate change:

- `expressions-v1/success.json` and `expressions-v2/success.json` `/queries`:
  nested `and`/`or`/`not` filters, `inDateRange` (every grammar form), `fill`
  and `timeKey`.
- `expressions-v1/rejections.json`: `inDateRange` with a bad value, in a
  measure filter, and in `having`; `fill` without `by`; `fill` on a metric
  query.
- `cache-preimages-v1/rejections.json`: `query-in-date-range-uncacheable`,
  `query-fill-uncacheable`, `query-time-key-uncacheable`. `success.json`:
  `fill-false-is-default`.
- `deployments-v3`: `alternateTimeFields` success and every reference
  rejection.

## Compatibility

Every field is optional. A query, invocation or contract valid before this RFC
is valid and means the same thing. A peer that predates it refuses the new
fields, because the envelopes are closed (`HQ_EXPRESSION_UNKNOWN_FIELD`,
`HQ_DEPLOYMENT_UNKNOWN_FIELD`), and the new operator
(`HQ_EXPRESSION_INVALID_OPERATOR`). A new caller talking to an old executor
therefore gets an error, never a silently wrong answer.

Logical filters were already valid on the wire. An executor that refused them
(`unsupported-capability`) now runs them. That is the one change in behaviour
for an existing request, and it turns a refusal into an answer.

Python validates the same grammar (shared fixtures). Python execution of
logical groups, relative ranges, fill and time-key selection lags TypeScript
and refuses until implemented. It never drops them. `datasets` publishing in
Python must emit `alternateTimeFields` before it publishes a dataset with
time keys.

## Feature coverage (amends RFC 0003)

| Datasets feature | Portable representation or boundary |
| --- | --- |
| Nested `and`/`or`/`not` filter groups | `logical` predicates in query `filters` |
| Relative date ranges on a time axis | `inDateRange` comparison, resolved by the executor |
| Zero-filled plain `by` series | Query envelope `fill` |
| Alternate time axes (`timeKeys`) | Contract 3 `alternateTimeFields`, query `timeKey` |
