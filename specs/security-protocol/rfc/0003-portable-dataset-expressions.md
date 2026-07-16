# RFC 0003: Portable dataset expressions and semantic queries

- Status: Proposed
- Version: expression extension 1

## Summary

This RFC defines a closed, language-neutral expression AST and query envelope
for Hypequery datasets. It lets TypeScript, Python, local tooling, Serve, and
Cloud exchange semantic intent without exchanging source-language callbacks or
accepting executable SQL from an untrusted query caller.

The protocol describes intent only. A consumer MUST validate references,
filter permissions, relationship queryability, limits, and tenant policy
against the separately versioned dataset contract before execution.

## Expression nodes

Every node is an object with a required `kind`. Unknown fields and unknown
kinds MUST be rejected.

- `reference`: a portable qualified identifier in `name`.
- `literal`: a canonical protocol value in `value`.
- `binary`: `add`, `subtract`, `multiply`, or `divide`, with `left` and `right`.
- `call`: one of `nullIfZero`, `coalesce`, `round`, `floor`, or `ceil`, with
  its fixed-arity `args` array. `round` accepts one or two arguments.
- `comparison`: one of `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`,
  `between`, or `like`, with `left` and `right`.
- `logical`: `and` or `or` with at least two `operands`, or `not` with one
  `operand`.
- `aggregate`: one of `sum`, `count`, `countDistinct`, `avg`, `min`, `max`,
  `argMax`, `argMin`, `percentile`, `stddev`, or `variance`, with `field`.

`argMax` and `argMin` MUST include `argField` and MUST NOT include filters.
`percentile` MUST include a finite `level` in the inclusive range 0 through 1.
Other aggregates MUST NOT include `argField` or `level`. `median` is authoring
sugar and is represented as `percentile` with level `0.5`.

The right operand of `in` and `notIn` MUST be a non-empty canonical array
literal. The right operand of `between` MUST be a two-item canonical tuple
literal. The right operand of `like` MUST be a string literal.

Aggregate `filters`, when present, are combined with AND by current dataset
adapters. An adapter MUST reject a filter expression it cannot faithfully
lower; it MUST NOT approximate it.

## Semantic query envelope

A dataset query has `kind: "dataset"`, a simple `dataset` identifier, and may
contain `dimensions`, `measures`, `filters`, `orderBy`, `limit`, `offset`, `by`,
and `includeMeta`. A metric query has `kind: "metric"`, `dataset`, `metric`, and
the same fields except `measures`.

Dimensions, filters, and ordering may use qualified relationship paths. The
version 1 identifier limit therefore bounds traversal to eight segments, while
the current datasets adapter permits only one-hop `belongsTo` and `hasOne`
dimensions. `hasMany` remains discoverable metadata but is not executable.

`limit` and `offset` are non-negative safe integers.
The supported grains are `day`, `week`, `month`, `quarter`, and `year`.

## Dataset feature coverage

| Datasets feature | Portable representation or boundary |
| --- | --- |
| String, number, boolean, timestamp dimensions | Contract metadata; selected by qualified reference |
| Column aliases, labels, descriptions, filterable/groupable | Contract metadata |
| All 11 aggregation types, including median sugar | `aggregate` node |
| `argMax`/`argMin` secondary field | `argField` |
| Percentile level | `level` |
| Filtered measures | Aggregate `filters` |
| Derived metrics and every formula helper | Reference, literal, binary, and call nodes |
| Base, derived, and grained named metrics | Metric query envelope plus contract metadata |
| Derived metric dependencies (`uses`/`requires`) | References in formulas plus contract dependency metadata |
| All 10 filter operators | `comparison` node |
| Dataset and metric queries | Semantic query envelope |
| Dimension/measure projection | `dimensions` and `measures` |
| Ordering | `orderBy` |
| Pagination and result-size request | `limit` and `offset`; contract applies maximum |
| Time key and all five grains | Contract metadata plus `by` |
| `belongsTo` and `hasOne` traversal | Qualified references; contract validates one-hop queryability |
| `hasMany` | Contract metadata only; execution rejects fan-out |
| Dataset limits | Contract metadata; consumer enforces lower limits |
| Named filter definitions and allowed operators | Contract metadata; query uses comparison nodes |
| Dataset registry and semantic contract serialization | Producer-side contract assembly; not executable query input |
| Catalogs and generated AI/MCP tool schemas | Views derived from the dataset contract and query schema |
| Tenant key and tenant-required state | Contract metadata; trusted runtime supplies tenant scope |
| `includeMeta` | Query envelope flag |
| Typed result rows and canonical result values | Response contract concern; not query intent |
| Pagination, timing, SQL, tenant, and cache result metadata | Response/runtime concern; not query intent |
| Runtime tenant value and cache controls | Trusted execution context; never expression input |
| Raw SQL dimensions/measures and source table names | Trusted contract/deployment data; never untrusted AST nodes |
| SQL inspection, query signatures, and memory cache stores | Deterministic product/runtime services outside the AST |
| Query-builder/backend selection and in-memory backend | Runtime implementation detail; frozen backend plans are not this protocol |
| SQL identifier helpers and field-value validation helpers | Adapter implementation details |

This table is exhaustive for the public datasets feature surface at the time
of this proposal. Adding a datasets feature requires classifying it here or in
a successor extension before it can cross the portable boundary.

## Limits

| Limit | Maximum |
| --- | ---: |
| Expression depth | 16 |
| Expression nodes per validation operation | 1,000 |
| Items in one AST/query collection | 100 |

Products may impose lower limits. They cannot raise these limits while claiming
expression extension 1 conformance.

## Stable failure codes

- `HQ_EXPRESSION_TYPE`
- `HQ_EXPRESSION_UNKNOWN_FIELD`
- `HQ_EXPRESSION_UNKNOWN_KIND`
- `HQ_EXPRESSION_INVALID_IDENTIFIER`
- `HQ_EXPRESSION_INVALID_VALUE`
- `HQ_EXPRESSION_INVALID_OPERATOR`
- `HQ_EXPRESSION_INVALID_ARITY`
- `HQ_EXPRESSION_INVALID_AGGREGATION`
- `HQ_EXPRESSION_INVALID_QUERY`
- `HQ_EXPRESSION_TOO_DEEP`
- `HQ_EXPRESSION_TOO_MANY_NODES`
- `HQ_EXPRESSION_TOO_MANY_ITEMS`
- `HQ_EXPRESSION_UNSAFE_OBJECT`

## Security and compatibility

Objects with accessors, symbols, non-enumerable properties, custom prototypes,
or cycles MUST be rejected. Successful validation returns an immutable plain
data snapshot and never retains caller-owned containers.

Caller-supplied SQL, arbitrary function names, source-language callbacks,
tenant identity, credentials, and database connection details are outside this
AST. Trusted SQL produced during a build is specified separately by the query
implementation extension; it never becomes an untrusted expression node.
Unknown fields and operators fail closed. Changing node meaning, arity, limits,
or the closed registries requires a new expression extension or core protocol
version.
