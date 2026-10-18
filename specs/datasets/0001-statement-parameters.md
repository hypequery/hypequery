# Datasets 0001: Statement parameters and placeholder rendering

- Status: Proposed
- Scope: `@hypequery/datasets` (TypeScript). Python follows separately; see
  [Python](#python).
- Linear: P-HQ-24 milestone 1. Takes over the shared half of HQ-279
  ("`$n` renumbering across spliced derived SQL").
- Depends on: the dialect rules in hypequery/hypequery#704.

## Problem

Datasets assembles most statements from pieces. The query builder compiles an
inner query to `{ sql, parameters }` with positional `?` markers. Datasets then
pastes that SQL into an outer string and concatenates the parameter arrays.

| Site | Inner piece | Outer piece |
| --- | --- | --- |
| `utils/dataset-derived-query.ts` | builder base query in `WITH base AS (…)` | `having` predicates appended as more `?` |
| `utils/metric-derived-query.ts` | builder CTE in `WITH base AS (…)` | none today |
| `utils/time-measure-source-sql.ts` | builder scan in `_hq_raw AS (…)` | reused by the main statement *and* the preflight statement |
| `utils/dataset-having.ts` | n/a | writes `?` itself |

This works on ClickHouse for two reasons that do not carry over to other engines:

1. **`?` needs no numbering.** A pasted piece's markers are still correct
   wherever it lands, provided the arrays are concatenated in text order.
   Postgres uses `$1…$n`. A builder compiling the inner query alone numbers
   from `$1`, and the outer statement then collides with it.
2. **Text order happens to equal construction order.** Each site builds its
   inner piece first and appends later pieces after it. Nothing enforces this.
   A future site that builds an outer predicate before an inner CTE would bind
   values to the wrong placeholders, silently.

Renumbering afterwards by scanning for markers would need a correct lexer for
each engine. On Postgres it is also ambiguous: `?`, `?|` and `?&` are JSONB
operators that can appear in author-written `sql` fields, and dollar-quoted
strings (`$tag$…$tag$`) look like placeholders. The ClickHouse adapter already
lexes, in `splitSqlPlaceholders`, but that is safe only because the SQL is
ClickHouse.

A related gap: **one caller-influenced value is still written into the SQL
text.** Time-measure axis bounds come from the caller's time filter. They are
rendered as `parseDateTime64BestEffort('<literal>', …)`. That is correctly
escaped for ClickHouse, but it breaks the rule Python already follows: "every
value a caller influences leaves the SQL text."

## Goals

- One allocator per compiled statement owns every bound value. Placeholder
  spelling is decided **once, at render time**, by the dialect.
- Parameter order follows text order by construction, whatever order the
  planner builds pieces in.
- Never scan engine SQL to find placeholders.
- The ClickHouse output stays byte-identical: same `?` text, same
  `parameters` array. The golden corpus from #704 gates this.
- Leave room for typed parameters (BigQuery needs types for NULL and array
  values; Postgres sometimes needs casts) without requiring them now.

## Non-goals

- Server-side named parameters for ClickHouse. The TS ClickHouse adapter keeps
  substituting on the client, and `compileDataset()` keeps its positional
  shape.
- The RFC 0001/0005 typed compiled-SQL protocol model (HQ-225).
- Changing how `@hypequery/clickhouse` compiles its own queries.

## Design

### Statement allocator

```ts
/** Internal. One per rendered statement family (main + preflight). */
interface StatementParameters {
  /** Bind one value; returns an opaque marker to place where the value goes. */
  bind(value: unknown, type?: ParameterType): string;
  /** Embed a compiled builder piece. Returns a marker for its SQL. */
  embed(piece: BuilderStatement): string;
  /** Replace markers in text order and spell placeholders for the dialect. */
  render(text: string): { sql: string; parameters: unknown[] };
}
```

- **Markers** are opaque tokens delimited by private-use code points:
  `U+E000 <nonce>:<kind>:<n> U+E001`. The nonce is random per allocator. The
  planner keeps working with strings, so none of the pass-through code from
  #704 changes: a marker is just text inside an expression.
- **`render` scans only for this allocator's delimiters**, never for engine
  syntax. Two cases fail closed:
  - a delimiter whose nonce doesn't match this allocator, for example a piece
    leaked from another compilation;
  - a marker left over after rendering.

  A caller cannot forge a marker: the nonce is unguessable, and caller values
  never enter the text once the axis bounds are bound (see the rollout).
- **Text order wins.** `render` assigns placeholder indices in the order
  markers appear in the final text, not the order they were bound.
- **Re-use.** A value marker can appear more than once. On ClickHouse and
  BigQuery each occurrence emits its own `?` and its own parameter entry, so
  values are duplicated. On Postgres each occurrence reuses its `$k`.
- **The main and preflight statements** share one allocator but are rendered
  separately. Each gets its own numbering and parameter array, which matches
  how they already execute as two `rawQuery` calls.

### Dialect rules

Three additions to `DatasetSqlDialectRules`:

```ts
/** Spell the placeholder for the value at `index` in the rendered parameter array. */
placeholder(index: number, parameter: BoundParameter): string;
/** A repeated value re-uses its placeholder (`$k`) rather than binding again. */
readonly reusesPlaceholders: boolean;
/** Whether a builder's own positional `?` pieces can be embedded verbatim. */
readonly embedsPositionalPieces: boolean;
```

| Dialect | `placeholder` | Re-use | `embedsPositionalPieces` |
| --- | --- | --- | --- |
| ClickHouse | `?` | duplicate | `true` |
| BigQuery (planned) | `?` (positional; typed via `parameter.type`) | duplicate | `true` |
| Postgres (planned) | `$<index+1>`, optionally `$n::<type>` | reuse `$k` | `false` |

### Builder pieces

`embedBuilder` handles query-builder output according to the dialect.

1. **Numbering dialects** (`embedsPositionalPieces: false`, such as Postgres)
   require the builder to render its placeholders through a callback, so
   datasets supplies the markers:

   ```ts
   interface QueryBuilderLike {
     // existing
     toSQLWithParams(): { sql: string; parameters: unknown[] };
     /** Optional: render each bound value through `placeholder`. */
     toSQLWithPlaceholders?(placeholder: (value: unknown) => string): string;
   }
   ```

   `embedBuilder` calls it with `allocator.bind` and requires a string result.
   The builder never chooses how a placeholder is spelled and never numbers
   anything. A builder without the method is rejected:

   > The "postgres" datasets dialect numbers placeholders; the query builder
   > must implement toSQLWithPlaceholders.

   The Postgres builder (HQ-279) implements this from day one.
   `@hypequery/clickhouse` implements it from 2.14.0 by splitting its own
   compiled output with `splitSqlPlaceholders`, which is safe because that SQL
   is ClickHouse.

2. **Positional `?` dialects** (ClickHouse, BigQuery) embed the builder's
   `{ sql, parameters }` as one positional block and **never call the
   callback**, even when the builder has one. At render time the block's SQL is
   spliced verbatim and its parameters are inserted at that point in text
   order.

   *Amended 2026-10-18 (#708):* this was originally "prefer the callback
   whenever it exists". `QueryBuilderLike` is a public duck-typed protocol, and
   a mock builder that answers every property name (a `Proxy`) appeared to
   implement the method but returned a non-string. Calling the callback only
   where it is needed leaves behaviour on positional dialects unchanged for
   every existing builder, including the chDB adapter and custom builders.

### Single render point

Rendering happens at the dispatch points that already exist, and nowhere else:

- `prepareDatasetQuery` (`utils/compile-dataset-query.ts`), for the main
  statement and each preflight statement;
- `MetricQueryEngine` (`metric-query-engine.ts`), for metric `toSQL` and
  execute.

No other code sees rendered SQL. So `toSQL()`, `compileDataset()`,
`meta.sql`, cache inputs and error messages never contain markers. A unit
test asserts that no public output contains U+E000.

### Parameter types

`bind(value, type?)` accepts an optional logical type, `ParameterType`: a
`DimensionType`, or `{ array: DimensionType }`. Planner sites that know the
field's type pass it: having conditions use the measure's numeric type, and
the axis bounds are timestamps. ClickHouse ignores it. Postgres can use it to
add casts where inference fails (for example `$1` in a `SELECT` list, or
comparisons against literals). BigQuery requires it for NULL and arrays.
Mapping these to RFC 0001 types is HQ-225's job. This design only makes sure
the information isn't lost.

### What this replaces

- Concatenating `parameters.push(...)` arrays at the three splice sites and in
  `datasetHavingSql`.
- `datasetHavingSql` writing `?` itself. It takes the allocator and calls
  `bind`.
- The implicit "build in text order" convention, which is now enforced by
  `render`.

## Alternatives considered

**Lex and renumber at the end.** Keep `?` everywhere and rewrite it to `$n`
with an engine lexer just before execution. This is the smallest change, but it
needs a correct lexer per engine and is ambiguous on Postgres (`?` JSONB
operators, dollar quoting). It also fails silently when wrong. Rejected.

**Template fragments.** Every emitter returns `{ strings[], values[] }` and
composes with a tagged template, so there is no marker text at all. This is
the most type-safe option, but every string-returning rule and helper from
#704 would change signature, for a benefit only the four parameterised sites
need. Rejected for now. Markers can migrate to fragments later behind the same
`StatementParameters` interface.

**A start offset passed to the builder.** For example
`toSQLWithParams({ firstIndex })`. This fixes numbering but still ties
correctness to construction order, and it bakes `$n` into the builder
protocol. Rejected.

**Named server parameters on every engine** (the Python model, `{p0:Type}`).
This is the right long-term protocol shape (RFC 0005), but it forces types at
every bind site and changes the ClickHouse execution path and the public
compilation output. The allocator here allows named rendering later: a dialect
can spell `placeholder()` as `{p<index>:<type>}`.

## Rollout

Each step is its own PR. Every step except 2 keeps the golden corpus
byte-identical.

1. **Allocator and render.** Add `StatementParameters`, the dialect
   `placeholder` / `reusesPlaceholders` / `embedsPositionalPieces` rules, and the fallback positional
   embedding. Route the three splice sites, `having`, and both render points
   through it. Tests:
   - markers render in text order even when bound out of order;
   - a re-used marker duplicates its value on ClickHouse;
   - a foreign nonce or a leftover marker throws;
   - `embed` without the callback throws for a non-positional test dialect;
   - no public output contains a marker.
   Implemented in hypequery/hypequery#706.
2. **Bind the axis bounds.** `parseTimestamp` takes a bound marker instead of
   a literal. **This intentionally changes the golden corpus:** literals become
   `?`, and `parameters` and the preflight statement gain entries. It is
   reviewed on its own, and it closes the last caller-value-in-text path.
   Implemented in hypequery/hypequery#707.
3. **`toSQLWithPlaceholders`.** Add the optional protocol method with type
   tests, and implement it in `@hypequery/clickhouse` (the builder's output is
   unchanged). Used only by numbering dialects. Implemented in
   hypequery/hypequery#708.
4. **Postgres dialect `placeholder`** (`$n`, reuse, casts from
   `ParameterType`). Lands with HQ-279. The parity corpus (HQ-309) checks the
   final parameter arrays.

## Decisions

Resolved on 2026-10-18.

1. **IN lists on Postgres are expanded** to `IN ($1, $2, …)`, today's shape,
   so results stay directly comparable with the ClickHouse parity corpus. The
   65,535-parameter cap applies. Binding one array (`= ANY($1)`, as Python
   does for ClickHouse) is revisited alongside typed arrays.
2. **Only caller-influenced values are bound.** Measure-filter literals and
   formula literals come from the dataset definition, which is trusted. They
   stay inline, spelled by `measureFilterLiteral` / `formulaLiteral`. Binding
   them would change SQL for no security gain and would add parameters to every
   aggregate.
3. **Timezone names stay inline**, spelled by `toQueryTimezone`. They are
   validated IANA names, a grammar that cannot carry SQL, and ClickHouse needs
   a constant zone for `DateTime64(9, tz)` typing. Python binds the zone; this
   is a documented difference, not drift.

## Python

Python's planner already allocates every caller value through one
`ParameterBinder` and renders `{name:Type}`. It is ahead of TypeScript on
binding, and does not splice builder SQL. The Postgres follow-up for Python
(HQ-322) needs only a dialect-owned placeholder spelling (`ParameterBinder`
hard-codes the ClickHouse form today). It does not need this allocator.
