# RFC 0028: SQL-sourced datasets

- Status: Proposed
- Version: SQL source 1
- Extends: RFC 0006 (dataset deployment contract), RFC 0013 (cache keys),
  RFC 0020 (row policies), RFC 0021 (resolved-row sources)

## Summary

A dataset's `source` is a physical table name today. This RFC adds a second
form: a single read-only `SELECT` with the tables it reads and the columns it
produces declared beside it.

```ts
dataset('activity', {
  source: {
    sql: `
      SELECT tenant_id, user_id, 'signup' AS step, created_at AS occurred_at FROM app.signups
      UNION ALL
      SELECT tenant_id, user_id, name AS step, timestamp AS occurred_at FROM app.events
      UNION ALL
      SELECT tenant_id, user_id, 'subscribed' AS step, started_at AS occurred_at FROM app.subscriptions FINAL
      UNION ALL
      SELECT tenant_id, user_id, 'paid' AS step, paid_at AS occurred_at FROM app.invoices`,
    dependencies: ['app.signups', 'app.events', 'app.subscriptions', 'app.invoices'],
    columns: { tenant_id: 'string', user_id: 'string', step: 'string', occurred_at: 'timestamp' },
  },
  tenantKey: 'tenant_id',
  timeKey: 'occurred_at',
  dimensions: { user_id: dimension.string(), step: dimension.string(), occurred_at: dimension.timestamp() },
  measures: { users: measure.countDistinct('user_id') },
});
```

The SQL is data, not code. It is checked once when the dataset is defined or a
contract is validated, published verbatim in the deployment contract, and read
by every query as a derived table, so tenant scoping, row policies, enforced
constraints and caller filters all apply on top of it exactly as they do on a
table.

## Motivation

Some datasets aren't one table. The common case is an event stream assembled
from several tables (signups, product events, subscriptions, invoices) with
`UNION ALL`. Cross-dataset funnels and retention (RFC 0027) need exactly that
stream. Today a team must create a ClickHouse view or materialized view outside
hypequery, which moves part of the model to a place the deployment contract
can't see, review or version. Cube allows any `SELECT` as a cube's source.

Fields already allow raw `sql` with declared `dependencies`, so expressions stay
analysable. A SQL source keeps the same discipline at the table level: the
contract says which tables are read and which columns exist, and anything the
checker can't prove is refused.

## Definition

`source` is either a table name (unchanged) or an object:

| Key | Type | Rule |
|---|---|---|
| `sql` | string | One read-only ClickHouse `SELECT`; see "SQL rules". |
| `alias` | string, optional | The derived table's alias, which field SQL may qualify columns with. A portable identifier; defaults to the dataset name. |
| `dependencies` | string[] | Every table the SQL reads, as `table` or `database.table`, spelled as in the SQL. Non-empty, unique, at most 64. |
| `columns` | `{ [name]: 'string' \| 'number' \| 'boolean' \| 'timestamp' }` | The derived table's columns. Non-empty, at most the dataset item limit. Names are portable identifiers. |

Unknown keys fail closed.

The declared columns are the only addressable columns. Every column reference
in the dataset must name one: column-backed dimensions (whose declared type must
equal the column's), `tenantKey`, `timeKey`/`timeKeys` that aren't dimensions,
filter fields that aren't dimensions, measure `field`/`argField` that aren't
dimensions, relationship `from` keys, row-policy fields, and raw-SQL field
`dependencies`. A reference may be bare or qualified with the alias
(`activity.step`). Fields qualified with a relationship name belong to its
target.

`rowResolution` and the deprecated `final` are refused on a SQL source. `FINAL`
is a table modifier and a derived table has no single table to resolve; write
`FROM t FINAL` (and any deletion/sign filter) inside the SQL instead.

## SQL rules

The checker lexes the SQL with ClickHouse's literal rules (single-quoted strings
with `\` and `''` escapes; backtick and double-quoted identifiers). It does not
parse the full grammar. Each rule below refuses a construct the lexer can see,
so the checker never has to decide whether a construct is harmless.

1. **Text.** Non-empty, at most 16 KiB of UTF-8, no control characters except
   tab, LF and CR. An unterminated literal or quoted identifier is refused.
   Outside literals and quoted identifiers only printable ASCII is allowed.
2. **One statement.** No `;` anywhere outside literals, including a trailing
   one.
3. **No comments.** `--`, `#` and `/*` outside literals are refused. A comment
   can't widen what the SQL does, but it is the classic place for lexer
   disagreement between the checker and the server.
4. **No parameters.** `?` anywhere (the TypeScript client substitutes positional
   placeholders into the whole statement), and `{`, `}` and `$` outside literals
   (server-side `{name:Type}` parameters and `$$` heredoc strings). The SQL
   is static; a query's values bind only to the predicates the planner adds.
5. **Read-only `SELECT`.** The first word is `SELECT` or `WITH`, and no
   parenthesized group starts with `EXPLAIN`, `DESCRIBE`, `DESC` or `SHOW`. The
   words `SETTINGS`, `FORMAT`, `INTO`, `OUTFILE`, `EXPLAIN`, `DESCRIBE` and
   `SHOW` are refused anywhere outside literals and quoted identifiers. Settings belong to the runtime (and some,
   like `readonly`, are the operator's isolation boundary); `FORMAT` and
   `INTO OUTFILE` change what the statement returns or where it writes. Since
   the statement starts with `SELECT`/`WITH` and is the only statement, no
   other statement verb can follow.
6. **Tables, not table functions.** After `FROM` or `JOIN` (except
   `ARRAY JOIN`), and after a `,` in a `FROM` list, the next token is either
   `(` (a subquery) or a table name, optionally database-qualified. A name
   followed by `(` is a table function and is refused: `url`, `remote`,
   `remoteSecure`, `cluster`, `file`, `s3`, `hdfs`, `mysql`, `postgresql`,
   `jdbc`, `odbc`, `executable`, `merge`, `numbers`, `generateRandom` and every
   other one. A parenthesized target must start a query (`SELECT`, `WITH` or a
   further `(`), and a name has at most two parts; anything else is refused.
   A comma after `JOIN`, `ON`, `USING` or `SAMPLE` at the same level also
   starts a table reference, so write `USING (a, b)` rather than `USING a, b`.
   A name after `IN` that isn't followed by `(` reads a table and is a table
   reference wherever it appears, function arguments included. (This
   refuses `position(a IN b)`; write `position(b, a)`.) `FROM` starts a table
   reference at any parenthesis level, including ClickHouse's FROM-first
   `(FROM t SELECT …)`, except directly inside `EXTRACT`, `SUBSTRING`,
   `SUBSTR`, `TRIM` and `OVERLAY`, whose own syntax uses it.
7. **No out-of-band reads or blocking.** Calls to functions that read an object
   named in a string, the filesystem, or that sleep are refused: names starting
   with `dict` (`dictGet`, `dictHas`, …), `joinGet`, `joinGetOrNull`, `file`,
   `getSetting`, `getSettingOrDefault`, `getServerSetting`, `getMacro`,
   `hasColumnInTable`, `catboostEvaluate`, `sleep`, `sleepEachRow`.
8. **System databases.** References and dependencies in `system`,
   `information_schema` or `INFORMATION_SCHEMA` are refused.
9. **Coverage.** The set of table references equals the declared
   `dependencies`: an undeclared reference is refused, and so is a declared
   dependency the SQL never reads. An unqualified name that resolves to a CTE
   in scope (`WITH name AS (…)` at the same or an enclosing parenthesis level)
   is not a table reference. Names are compared after unquoting, exactly as
   written; `events` and `app.events` are different dependencies.

The checker records whether the SQL contains the word `FINAL` outside literals.

The rules are lexical and deliberately conservative: a column called `format`
must be quoted (`` `format` ``), and a comma-join such as `FROM a, b` is
accepted only because rule 6 treats each list item as a table reference.

## Query planning

The planner reads a SQL source as

```sql
(SELECT `tenant_id`, `user_id`, `step`, `occurred_at` FROM (<sql>)) AS `activity`
```

The projection lists the declared columns, quoted, in declared order, so a
column the SQL produces but doesn't declare is unreachable and a column named
like a keyword still projects. A declared column the SQL doesn't produce fails
at execution with ClickHouse's own error. The alias qualifies base columns
wherever a table source would use the table name. It is part of the source,
not the dataset's name: publishing a dataset under another name keeps it, so
field SQL that qualifies with it stays valid after rehydration.

Interaction with existing semantics:

- **Tenant scoping and row policies (RFC 0020).** The tenant predicate, row
  policies and enforced constraints are ANDed onto the outer query against
  `activity.<column>`, through the same single application point as for a
  table. They don't depend on ClickHouse pushing predicates into the subquery;
  pushdown only affects cost. ClickHouse's own row policies on the underlying
  tables apply to the reading user as for any read.
- **Resolved rows (RFC 0021).** Refused at the dataset level (above). When the
  SQL contains `FINAL`, every query that reads the dataset pins
  `optimize_move_to_prewhere_if_final = 0`, as a builder setting and in the
  `SETTINGS` clause of raw-SQL statements, exactly as for a resolved-row
  dataset.
- **Relationships.** A SQL-sourced dataset may declare relationships to other
  datasets; joins qualify its side with the alias. A SQL-sourced dataset can't
  be a relationship target in version 1: target joins, uniqueness checks and
  relationship measures read the target's table by name. The relationship is
  refused when the dataset is defined or the contract is validated
  (`HQ_DEPLOYMENT_INVALID_REFERENCE` at the relationship's `target`).
- **Engines.** The rules are ClickHouse's. Other SQL dialects, the frozen
  semantic-backend path and the in-memory backend refuse a SQL-sourced dataset.

## Deployment contract

The contract carries the source in dataset contract and deployment versions 2
and 3:

```json
{
  "source": {
    "kind": "sql",
    "dialect": "clickhouse",
    "sql": "SELECT tenant_id, user_id, … FROM app.invoices",
    "alias": "activity",
    "dependencies": ["app.signups", "app.events", "app.subscriptions", "app.invoices"],
    "columns": [
      { "name": "tenant_id", "type": "string" },
      { "name": "user_id", "type": "string" },
      { "name": "step", "type": "string" },
      { "name": "occurred_at", "type": "timestamp" }
    ]
  }
}
```

`kind` and `dialect` are required and must be `sql` and `clickhouse`. `alias`
is required in the contract; publishing writes the code-first default. Columns
are an array in declared order, which is the projection order. The validator
applies every rule in this RFC. Structural failures use the existing codes
(`HQ_DEPLOYMENT_TYPE`, `HQ_DEPLOYMENT_UNKNOWN_FIELD`,
`HQ_DEPLOYMENT_INVALID_IDENTIFIER`, `HQ_DEPLOYMENT_TOO_MANY_ITEMS`,
`HQ_DEPLOYMENT_TOO_LARGE`); a SQL rule failure is `HQ_DEPLOYMENT_INVALID_VALUE`
at `…source.sql` (including a dependency in a system database); a coverage
failure is `HQ_DEPLOYMENT_INVALID_REFERENCE` at `…source.dependencies`.

The contract validator checks every column reference it can name:

- the tenant field;
- each column-backed dimension's column and type;
- SQL-expression dimension and measure dependencies;
- `timeField`, measure `field`/`argField` and filter fields that aren't
  dimensions or relationship-qualified;
- relationship `from` keys.

Each failure is `HQ_DEPLOYMENT_INVALID_REFERENCE` at that field.
`rowResolution` beside a SQL source is `HQ_DEPLOYMENT_INVALID_VALUE` at
`…rowResolution`. Measure filters are expressions; the definition rules check
them on rehydration, before a portable executor plans a query.

Older validators read `source` as text and reject the object
(`HQ_DEPLOYMENT_TYPE`). Consumers upgrade together; nothing strips the object or
falls back to a table.

Publishing maps the code-first object to this form and rehydration maps it back,
so a published dataset and its rehydrated copy plan identical SQL. The portable
executor queries a rehydrated SQL-sourced dataset like any other.

## Caching and identity

The SQL source is part of the contract, so it is part of deployment identity
with no further rule. Locally, the RFC 0013 preimage's definition identity
describes the whole dataset instance, which carries the SQL source, so result
cache keys change when the SQL, a dependency or a column does. The readable
(deprecated) query signature adds `sourceSha256`: the lowercase hex SHA-256 of
the sorted-key JSON of the contract form above. It is omitted for table
sources, so their keys don't change.

## Exposure

The SQL, its dependencies and its columns appear only in the deployment
contract, which is already an operator artifact. The agent catalog, the client
contract (RFC 0018) and MCP tool metadata don't carry them; they describe the
dataset by name and its fields, as for a table.

## Security review

- **Who writes the SQL.** Only the model author, in code or through a reviewed
  publish. No caller input reaches it: a query can't choose, extend or
  parameterize the source. This is the same trust level as a dimension's raw
  `sql`, and the same review applies.
- **Tenant isolation.** The tenant predicate is applied outside the derived
  table, so the planner never trusts the SQL to filter tenants. What it does
  trust is the SQL's *labelling*: the tenant column must carry the row's real
  tenant in every branch. A branch that projects a constant or the wrong column
  as `tenant_id` assigns rows to the wrong tenant, just as a table with bad data
  would. Reviewers must check the tenant column in every `UNION ALL` branch and
  join. The planner can't detect this, so the RFC says so rather than implying
  otherwise.
- **Injection.** The SQL is static and validated before any query runs. With no
  placeholders, parameters, heredocs, comments or second statement, a value a
  caller supplies can only ever bind to the planner's own predicates. Quoted
  spans are lexed with ClickHouse's escape rules, and an unterminated span is
  refused, so a literal can't hide a statement break from the checker.
- **Reach.** Table functions and out-of-band readers are refused, so the SQL
  reads only the tables it declares, with the reading user's grants. It can't
  reach another server, the network, the filesystem, dictionaries or system
  tables. Operators should still run hypequery as a `readonly` user with
  grants limited to the declared dependencies; the deployment contract lists
  them, so the grant is reviewable.
- **Cost.** A SQL source can be expensive: every query scans every branch that
  survives predicate pushdown, and pushdown stops at a `GROUP BY`, window or
  `LIMIT` inside the source. The runtime's existing per-query execution limits,
  result limits and timeouts apply unchanged; the SQL can't change them
  (rule 5). Authors should keep aggregation out of the source and let measures
  aggregate. A future version may add declared cost hints; this one doesn't.
- **Checker limits.** The checker is lexical. It errs towards refusal (a quoted
  column named `format` is fine; a bare one isn't) and the RFC lists every word
  and function it refuses, so behaviour is predictable across implementations.

## Conformance

Proposed fixtures live in `drafts/sql-sources-v1/`: an accepted activity-stream
contract and one rejection per rule. They aren't conformance gates until this
RFC is accepted.

## Implementations

TypeScript validates, publishes, rehydrates and plans SQL sources. Executable
ClickHouse reconciliation is in
`packages/datasets/src/tests/integration/sql-sources.test.ts`: per-step totals
against independent SQL with unmerged ReplacingMergeTree versions under
PREWHERE-unsafe client settings, colliding user ids across tenants, a join to a
table dataset, a raw-SQL cumulative measure, and the rehydrated contract run by
a `readonly = 2` user. Python
doesn't implement them yet: its contract check reads `source` as text and
rejects the object (`HQ_DEPLOYMENT_TYPE`), which fails closed. Parity is a
follow-up before acceptance.

## Out of scope

- SQL-sourced datasets as relationship targets.
- Parameterized sources, and sources that depend on the query.
- Cost hints, materialization and refresh policies.
- Dialects other than ClickHouse.
