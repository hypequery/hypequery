# RFC 0026: Query-scoped calculations

- Status: Proposed
- Version: none (additive fields in expression extension 2)

A semantic query can only select what a model published. Period-over-period,
a line per filtered variant, a ratio of two measures, Top-N per group, share of
total and rank all need a model change and a publish today, so an agent that
is asked "revenue vs last month, by country, top 5 and the rest as Other"
either refuses or computes it client side over a truncated result. Client-side
transforms are wrong whenever the result was limited, and they cannot be
permission-checked against the contract.

This RFC lets a dataset query carry **calculations**: one-off variants of
published measures, named by the caller and compiled by the same planner that
compiles model-level measures. Results are exact, inputs are checked against
what the caller may see, and anything that cannot be computed exactly is
refused by name.

Calculations are not a new expression language. Each kind maps onto a planner
the datasets package already ships:

| Kind | Model-level equivalent | Planner |
| --- | --- | --- |
| `filter` | filtered measure (`measure.sum(..., { filters })`) | conditional aggregate |
| `shift` | `measure.shift` (contract 3) | time-measure planner |
| `window` | `measure.trailing` / `toDate` / `cumulative` (contract 3) | time-measure planner |
| `formula` | `measure.derived` | post-aggregation formula |
| `compare` | sugar: `shift` + two `formula`s per measure | as above |
| `rank` | none | window function over the grouped result |
| `share` | none | window function, or a coarser-grain aggregate |

plus two query fields that change grouping or row selection: `limitBy` (Top-N
per group) and `other` (Top-N plus a remainder bucket).

## Query envelope (RFC 0003)

A **dataset** query validated under **expression extension 2** may contain
`calculations`, `limitBy` and `other`. They sit after `having` in document
order. Under extension 1, and on a metric query, each fails with
`HQ_EXPRESSION_UNKNOWN_FIELD`, exactly as an unknown member does, so a peer
that predates this RFC refuses rather than ignores them.

```json
{
  "kind": "dataset",
  "dataset": "orders",
  "dimensions": ["country"],
  "measures": ["revenue", "orders"],
  "by": "month",
  "filters": [
    { "kind": "comparison", "operator": "between",
      "left": { "kind": "reference", "name": "created_at" },
      "right": { "kind": "literal", "value": { "$hypequery": { "type": "array", "version": 1,
        "values": ["2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z"] } } } }
  ],
  "calculations": [
    { "name": "us_revenue", "filter": { "measure": "revenue", "where": [
      { "kind": "comparison", "operator": "eq",
        "left": { "kind": "reference", "name": "channel" },
        "right": { "kind": "literal", "value": "web" } } ] } },
    { "name": "aov", "formula": { "op": "divide", "args": ["revenue", { "op": "nullIfZero", "args": ["orders"] }] } },
    { "name": "vs_prior", "compare": { "to": "previousPeriod", "measures": ["revenue"] } },
    { "name": "revenue_rank", "rank": { "measure": "revenue", "within": ["period"] } }
  ],
  "having": [{ "measure": "revenue_change_pct", "operator": "gt", "value": 0.1 }],
  "orderBy": [{ "field": "period", "direction": "asc" }, { "field": "revenue_rank", "direction": "asc" }],
  "limitBy": { "n": 5, "by": ["period"] }
}
```

### `calculations`

An array of entries. Each entry is an object with exactly two members: `name`
and one **kind** member (`filter`, `shift`, `window`, `formula`, `compare`,
`rank` or `share`). An entry with no kind member, or with two, fails with
`HQ_EXPRESSION_INVALID_QUERY`; any other member fails with
`HQ_EXPRESSION_UNKNOWN_FIELD`. A kind outside this list is an unknown member,
so a future kind is refused by a peer that predates it.

`name` is a simple identifier (RFC 0002). Every entry produces one or more
**output columns**; the names of all output columns must be unique across
`dimensions`, `measures`, `period` (when `by` is present) and every other
output column, or the query fails with `HQ_EXPRESSION_INVALID_QUERY` at the
entry's `name`. An output name may equal a published field the query does not
select: it is a column of this result, never a reference into the model, so a
caller that cannot see a hidden field learns nothing about it by naming a
calculation after it.

An **input reference** is a simple identifier naming either a published
measure, or the output column of an *earlier* entry. Forward references fail
with `HQ_EXPRESSION_INVALID_QUERY`, so the entries form a DAG by construction
and there is no cycle check. Qualified (relationship) measures are not
calculation inputs in this version.

The array follows the collection rules of every other query field (RFC 0003
limits); an empty array asks for nothing.

#### `filter` — conditional aggregate

```json
{ "name": "web_revenue", "filter": { "measure": "revenue", "where": [<comparison>, ...] } }
```

The output aggregates `measure` over only the rows matching every `where`
comparison (AND), exactly as a model-level filtered measure does: the same SQL
(`sum(if(cond, x, 0))`, `count(if(cond, x, NULL))`, ...). The query's own
`filters` still apply to every row. A filter calculation over a measure that
already declares model filters ANDs both.

- `measure` must be a published **base** measure. `argMax`, `argMin` and
  `merge` measures are refused, as they are for model-level filtered measures.
- `where` is a non-empty array of comparison nodes whose left operand is a
  reference and whose right operand (absent for `isNull`/`isNotNull`) is a
  literal — the shape a query filter has. Anything else fails with
  `HQ_EXPRESSION_INVALID_QUERY`.
- Execution checks each comparison exactly as a query filter: the field is one
  the caller may filter on, the operator is allowed on it, and the value has
  the field's type. Only local (unqualified) fields are accepted. Each
  comparison counts toward the dataset's `maxFilters`, with `filters` and
  `having`.

#### `shift` — the same measure, an earlier bucket

```json
{ "name": "revenue_last_year", "shift": { "measure": "revenue", "amount": 1, "unit": "year" } }
```

Evaluates `measure` over the aligned bucket `amount` `unit`s earlier — the
contract 3 shift measure. `amount` is a positive safe integer no greater than
1,000; `unit` is an extension 2 grain. `measure` is a published base or
derived measure, or an earlier `filter` or `formula` entry, and must not
itself depend on a `shift` or `window`.

#### `window` — trailing, to-date or running

```json
{ "name": "revenue_3m", "window": { "measure": "revenue", "trailing": { "amount": 3, "unit": "month" } } }
{ "name": "revenue_ytd", "window": { "measure": "revenue", "toDate": "year" } }
{ "name": "revenue_running", "window": { "measure": "revenue", "cumulative": true } }
```

The contract 3 window measure. The `window` object holds `measure` and exactly
one mode. `measure` is a published base measure or an earlier `filter` entry.
`cumulative` accumulates only `sum`, `count`, `min` and `max`; `toDate` takes a
grain other than `minute`; `trailing` takes `{ amount, unit }` as `shift` does.

#### Time-measure rules (shift, window, compare)

These inherit every contract 3 constraint, checked at execution:

1. `by` is present.
2. `filters` contains exactly one bounded range on the dataset's time field:
   one `between`, or one `gt`/`gte` with one `lt`/`lte`, with ISO timestamps.
3. The interval spans whole `by` buckets (`trailing: 7 day` at `by: week`
   works; `trailing: 10 day` at `by: week` does not). Calendar shifts of a
   month, quarter or year are accepted at finer grains.
4. The series is gap-filled: every bucket in the range appears, for every
   dimension combination that has rows in the range.
5. The number of buckets must not exceed the effective row limit.

#### `formula` — arithmetic over outputs

```json
{ "name": "aov", "formula": { "op": "divide", "args": ["revenue", { "op": "nullIfZero", "args": ["orders"] }] } }
```

A formula node is `{ "op", "args" }`. Each argument is an input reference (a
string), a finite JSON number, or another formula node:

| `op` | Arity | SQL |
| --- | --- | --- |
| `add`, `subtract`, `multiply`, `divide` | 2 | `a + b`, `a - b`, `a * b`, `a / b` |
| `nullIfZero` | 1 | `NULLIF(a, 0)` |
| `coalesce` | 2 | `COALESCE(a, b)` |
| `round` | 1 or 2 | `ROUND(a[, n])`; `n` a literal integer 0–15 |
| `floor`, `ceil` | 1 | `FLOOR(a)`, `CEIL(a)` |
| `percentChange` | 2 | `(a - b) / NULLIF(b, 0)` |

This is the derived-measure grammar (RFC 0006), plus `percentChange` and
numeric literals in any operand position. `percentChange` is a **ratio**:
`0.25` means +25%; it is NULL when the earlier value is zero or NULL. The root
must be a node, not a bare reference or number, and at least one argument
somewhere must be a reference. References name a measure selected in
`measures` or an earlier `filter`, `shift`, `window`, `formula` or `compare`
output; `rank` and `share` outputs are computed after formulas and cannot be
formula inputs. Division by zero follows the engine (ClickHouse returns
`inf`/`nan`); wrap a divisor in `nullIfZero` to get NULL. Nesting counts
toward the expression depth and node limits.

#### `compare` — period over period

```json
{ "name": "vs_prior", "compare": { "to": "previousPeriod", "measures": ["revenue", "orders"] } }
```

Sugar. For each measure `m` in `measures` (a non-empty list of distinct
measures selected in `measures` or earlier `filter`/`formula` outputs) it
emits three output columns, in this order:

| Column | Equivalent entry |
| --- | --- |
| `<m>_previous` | `shift: { measure: m, amount: 1, unit: <by> }` (`previousPeriod`) or `unit: "year"` (`previousYear`) |
| `<m>_change` | `formula: { op: "subtract", args: [m, "<m>_previous"] }` |
| `<m>_change_pct` | `formula: { op: "percentChange", args: [m, "<m>_previous"] }` |

`to` is `previousPeriod` or `previousYear`. `compare` requires `by` (rule 1
above, checked by the validator because the unit depends on it) and every
other time-measure rule. Its `name` labels the entry in errors and metadata;
it is not itself an output column. An emitted name that is not a valid
identifier (for example, over the length limit) fails with
`HQ_EXPRESSION_INVALID_QUERY`.

#### `rank`

```json
{ "name": "revenue_rank", "rank": { "measure": "revenue", "within": ["period"], "direction": "desc" } }
```

SQL `rank()` over the grouped result: 1 for the highest (`desc`, the default)
or lowest (`asc`) value; ties share a rank and the next rank skips; NULL values
rank last. `within` (default `[]`) lists the partition: selected dimensions,
plus `period` when `by` is present. `measure` is a selected measure or any
earlier output other than `rank`/`share`. The output is an integer.

#### `share` — percent of total

```json
{ "name": "revenue_share", "share": { "measure": "revenue", "of": ["period"] } }
```

`measure` divided by its total at the grain `of`, as a ratio (0–1 for an
additive measure). `of` lists the dimensions the total keeps — selected
dimensions, plus `period` when `by` is present — so with `dimensions:
["country", "product"]`, `of: ["country"]` is each product's share of its
country and `of: []` (the default) is each row's share of the grand total.
The denominator is never NULL-filled; a zero total gives NULL.

The denominator is always exact:

- An **additive** input — a `sum` or `count` base measure, or a `filter`,
  `shift` or `window` (`trailing`, `toDate`, `cumulative`) over one — uses
  `sum(x) OVER (PARTITION BY of)` over the grouped result.
- Any other input (`countDistinct`, `avg`, `percentile`, a formula, ...) is
  re-aggregated from source rows at the `of` grain, with the same filters,
  segments, tenancy and `other` bucketing, and joined back on `of` (NULL
  keys match). A non-additive input that depends on a `shift` or `window` is
  refused: it has no exact coarser-grain form in this version.

Denominators are computed before `having` and before `limitBy`, `limit` and
`offset`: a share is of everything the filters select, never of the page.

### `limitBy` — Top-N per group

```json
"limitBy": { "n": 3, "by": ["period"] }
```

Keeps the first `n` rows of each `by` group in `orderBy` order — ClickHouse
`LIMIT n BY`. `n` is a positive safe integer; `by` is a non-empty list of
distinct selected dimensions (plus `period`). `orderBy` must be non-empty,
because without it the kept rows are arbitrary. Applied after `having` and
before `limit`/`offset`. Executors on engines without `LIMIT BY` refuse it with
`unsupported-capability`.

### `other` — Top-N and the rest

```json
"other": { "dimension": "country", "n": 5, "measure": "revenue", "label": "Other" }
```

Groups `dimension` as itself for its `n` highest values of `measure` (over
the whole filtered query, not per period), and as `label` (default `"Other"`)
for everything else, in a single query:

```sql
WITH _hq_other_top AS (SELECT country FROM ... WHERE <same filters> AND country IS NOT NULL
                       GROUP BY country ORDER BY <measure> DESC LIMIT 5)
SELECT if(country IN (SELECT country FROM _hq_other_top), country, 'Other') AS country, ...
GROUP BY country ...
```

Because every row is re-grouped from source, every measure and calculation in
the bucketed row is exact, including `countDistinct`. `dimension` is a
selected, local, string-typed dimension; `measure` is a published base or
derived measure; `n` is a positive safe integer no greater than 1,000; `label`
is a string of 1–64 characters with no control characters. NULL values are
never a top value and fall in the remainder. A real value equal to `label`
merges into the remainder. Query filters on `dimension` still read the
original values. `other` is refused with a relationship (qualified) field
anywhere in the query.

### `having` and `orderBy` on calculations

`having[].measure` and `orderBy[].field` may name any output column a
calculation produces, as well as selected measures. RFC 0025's "the measure
must be one the query selects" becomes "the measure must be a selected measure
or a calculation output". `having` therefore filters on `rank`, `share` and
time-measure outputs too: it applies after every calculation.

### Result metadata (RFC 0014)

A result for a query with at least one calculation carries
`meta.calculations`, one entry per output column in output order:

```json
"meta": {
  "rowCount": 12,
  "calculations": [
    { "name": "revenue_previous", "kind": "shift", "calculation": "vs_prior", "measure": "revenue", "type": "number" },
    { "name": "revenue_change_pct", "kind": "formula", "calculation": "vs_prior", "type": "number", "format": "ratio" },
    { "name": "revenue_rank", "kind": "rank", "calculation": "revenue_rank", "measure": "revenue", "type": "integer" }
  ]
}
```

- `name`: the output column. `calculation`: the entry that produced it (its
  `name`; for `compare`, the compare entry).
- `kind`: the planner kind that computed it (`compare` reports `shift` and
  `formula`).
- `measure`: the input it varies, for `filter`, `shift`, `window`, `rank` and
  `share`.
- `type`: `number` or `integer`. Values are JSON numbers or `null`.
- `format`: `ratio` for `share`, `percentChange` roots and `<m>_change_pct`.

Without calculations `meta` is unchanged, so no existing result moves. A
result validator accepts `meta.calculations` with exactly these members.

## Execution

An executor compiles calculations; it never evaluates them over returned rows.
The reference implementation turns `filter`, `shift`, `window` and `formula`
entries into measures of a query-scoped view of the dataset, under reserved
internal names, so the planners that compile model-level measures compile them
too. `rank`, `share`, `limitBy`, `having` and output naming run in one outer
stage over the planned statement. `other` rewrites the dimension in the view.

A deployment data plane additionally checks, failing with `input-invalid` and
the offending path:

- Every input reference is a measure visible to the caller (RFC 0019) or an
  earlier output. A hidden measure fails exactly as an unknown one.
- `filter.where` fields are filters visible to the caller, with their allowed
  operators; `filter.measure` is a base measure that accepts filters.
- `shift`, `window` and `compare` have `by` and a time field; `window.measure`
  is a base measure; `cumulative` only over `sum`/`count`/`min`/`max`.
- `rank.within`, `share.of` and `limitBy.by` name selected dimensions (or
  `period` with `by`); `other.dimension` is a selected string dimension.
- `measures` plus output columns stay within `maxMeasures`; `filters`,
  `having` and every `filter.where` comparison stay within `maxFilters`.

Constraints only the planner can check (interval/grain compatibility, the
bounded range, series length) fail at execution with `input-invalid`. An
executor that cannot run a calculation kind or query field must refuse with
`unsupported-capability`, naming it. It must never drop one.

## Cache preimage (RFC 0009)

A non-empty `calculations`, or any `limitBy` or `other`, has no portable key in
this version: building a preimage fails with `HQ_CACHE_PREIMAGE_INVALID_QUERY`,
as `having` does (RFC 0025). The executors already run such queries uncached.
No existing preimage or key moves.

## Conformance (RFC 0012)

A new family, `query-calculations-v1`, owned by this RFC and validated under
extension 2 (`/queries` success cases and `query` rejections, the
`expressions-v2` shapes). It is announced by the TypeScript reference adapter
first; Python adds it to its `--expect-families` list when it implements the
validator, so no release gate silently drops it. Outline:

- **Success**: one case per kind and mode; `compare` both `to`s; formula with
  every op, nested, literals, `percentChange`, references to earlier entries;
  `rank`/`share` with and without `within`/`of`, `period` in either; `limitBy`;
  `other` with and without `label`; `having`/`orderBy` on calculation outputs;
  an empty `calculations`.
- **Rejections**: the fields on a metric query
  (`HQ_EXPRESSION_UNKNOWN_FIELD`); an entry with zero or two kinds; an unknown
  member at each level; duplicate output names (with dimensions, measures,
  `period`, compare-emitted names); forward references; a formula with an
  unknown op, wrong arity, bare root, no reference, non-finite literal,
  `round` decimals out of range; `where` that is not a plain comparison or is
  empty; shift/window amount 0, over 1,000, non-integer, bad unit; window with
  zero or two modes, `toDate: "minute"`, `cumulative: false`; `compare`
  without `by`, empty or duplicate `measures`, a measure not selected,
  over-long emitted names; `rank`/`share` input that is a `rank`/`share`
  output; `within`/`of`/`limitBy.by` naming an unselected dimension or
  `period` without `by`; `limitBy` without `orderBy`, `n` 0; `other` naming an
  unselected dimension, `n` over 1,000, an empty or over-long `label`;
  `having` naming an unknown output or a `compare` entry's own name.
  (`orderBy` fields are checked against the contract by the data plane, as
  they are today, not by the envelope validator.)
- **`expressions-v1/rejections.json`** gains `calculations-extension-1`,
  `limit-by-extension-1` and `other-extension-1`
  (`HQ_EXPRESSION_UNKNOWN_FIELD`). Every extension 1 implementation already
  refuses them through the closed envelope, so these pin compatibility without
  new code.
- **Execution** (draft `drafts/query-calculations-v1/rows.json`): a small
  orders table with NULL dimension values, repeated users across groups and an
  empty month, with expected rows for each kind, pinned against brute-force SQL
  over the same rows, including `share` and `other` over `countDistinct`.

`cache-preimages-v1/rejections.json` gains `query-calculations-uncacheable`,
`query-limit-by-uncacheable` and `query-other-uncacheable`.

## Compatibility

All three fields are optional and extension 2 only. Every query valid before
this RFC is valid and means the same thing, and its result metadata is
unchanged. A peer that predates this RFC refuses a query carrying any of them
through the closed envelope, so a new caller talking to an old executor gets
an error, never a silently wrong answer.

## Feature coverage (amends RFC 0003)

| Datasets feature | Portable representation or boundary |
| --- | --- |
| Query-scoped filtered, shifted, windowed and derived measures | Query envelope `calculations` (`filter`, `shift`, `window`, `formula`) |
| Period-over-period comparison | `calculations[].compare` |
| Rank and share of total | `calculations[].rank`, `calculations[].share` |
| Top-N per group, Top-N with remainder | Query envelope `limitBy`, `other` |
