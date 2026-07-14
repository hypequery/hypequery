# RFC 0005: Portable query implementations

- Status: Proposed
- Version: query implementation extension 1

## Summary

The expression protocol describes untrusted query intent. It deliberately does
not describe every trusted implementation that can produce a query result.
Datasets currently permit developer-authored SQL dimensions and measures, and
Serve named queries may execute a semantic query, compiled SQL, or arbitrary
Node/Python code.

This RFC defines the trusted boundary between those implementation choices and
the public request protocol. Caller-provided SQL remains prohibited. SQL in
this extension is trusted build output carried in a deployment bundle and is
never accepted from a dataset query, dashboard, agent tool, or public query
request.

## Closed implementation union

A named query has portable input and output schemas defined by RFC 0004 and
exactly one implementation:

- `semantic-plan`: a validated RFC 0003 dataset or metric query. Version 1 is a
  concrete plan; parameterized semantic templates may be added by a later
  extension.
- `compiled-sql`: one read-only ClickHouse statement with typed, bound
  parameters and declared read sources.
- `runtime-reference`: an entrypoint in a separately hashed Node or Python
  artifact. This is the fallback for callbacks and source-language behavior
  that cannot be lowered without changing semantics.

The implementation union does not contain credentials, connection details,
tenant values, source code, environment variables, or interpolated parameter
values.

## Trusted SQL expressions

Dataset dimensions and measures may carry a `sql-expression` artifact. It has
an explicit `clickhouse` dialect, bounded SQL text, a portable output schema,
and the logical field dependencies used by tooling and compatibility checks.
Callers select the containing dimension or measure by identifier; they cannot
submit or alter the SQL text.

An SQL expression is a fragment, not a complete statement. A backend adapter
MUST parse or safely compose it in the syntactic position declared by the
dataset contract. The protocol validator does not claim to be a ClickHouse SQL
parser.

## Compiled SQL

`compiled-sql` contains:

- `dialect: "clickhouse"`;
- `operation: "select"`;
- the statement text;
- distinct named parameters, each bound from query input or trusted tenant
  context and carrying an explicit ClickHouse type;
- the physical sources the statement may read; and
- an explicit tenant policy.

Input parameters identify a path in the named query input object. Tenant
parameters obtain their value only from trusted execution context. A required
tenant policy names exactly one declared tenant parameter. A `not-required`
policy is an explicit security assertion and is not inferred from the absence
of a tenant parameter.

SQL text and physical source names are trusted, dialect-specific strings rather
than portable logical identifiers. SQL text permits tabs and line endings;
other controls are rejected. Physical sources and ClickHouse types reject all
controls. Every string is bounded, but full SQL and ClickHouse type grammar
validation belongs to the ClickHouse build/runtime adapter. A conforming
runtime MUST parse the statement, confirm that it is one read-only query of the
declared operation, bind values without string interpolation, enforce its
source allow-list, and apply its own lower resource limits before execution.

## Runtime references

A runtime reference contains a runtime (`node` or `python`), the lowercase
SHA-256 digest of an artifact present in the containing deployment bundle, and
a portable entrypoint name. The bundle envelope owns artifact location,
signature, runtime version, permissions, and isolation policy. Resolving a
digest from an ambient registry or filesystem path is not permitted by this
extension.

## Existing API coverage

| Existing feature | Portable treatment |
| --- | --- |
| Dynamic dataset/metric requests | RFC 0003 public semantic query |
| Plain dimensions, measures, formulas and filters | Dataset contract plus RFC 0003 |
| SQL-backed dimensions and measures | Trusted `sql-expression` |
| Fixed semantic named query | `semantic-plan` |
| Query builder lowered during build | `compiled-sql` |
| `rawQuery` lowered during build | `compiled-sql` when safely parameterized and read-only |
| Serve resolver callback | `runtime-reference` unless exactly lowerable |
| Zod/Pydantic input and output | RFC 0004 portable schemas |
| Authentication, roles, cache and HTTP metadata | Named-query/deployment contract extensions |
| Credentials, tenant value and connection | Trusted runtime context; never this artifact |

This extension therefore does not promise that arbitrary application code is
language-neutral. It makes the choice between a portable plan, portable
compiled SQL, and a language runtime explicit and inspectable.

## Limits

| Limit | Maximum |
| --- | ---: |
| SQL statement UTF-8 bytes | 1,048,576 |
| SQL expression UTF-8 bytes | 65,536 |
| ClickHouse type UTF-8 bytes | 256 |
| Physical source UTF-8 bytes | 1,024 |
| Parameters, sources, or dependencies in one object | 100 |

Products may impose lower limits. They cannot raise these limits while
claiming query implementation extension 1 conformance.

## Stable failure codes

- `HQ_QUERY_IMPLEMENTATION_TYPE`
- `HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD`
- `HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND`
- `HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER`
- `HQ_QUERY_IMPLEMENTATION_INVALID_VALUE`
- `HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE`
- `HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS`
- `HQ_QUERY_IMPLEMENTATION_TOO_LARGE`
- `HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT`

## Security and compatibility

Unknown kinds and fields fail closed. Objects with custom prototypes,
accessors, symbols, hidden properties, cycles, sparse arrays, or extra array
properties are rejected. Validation returns a detached, deeply immutable
snapshot.

Changing SQL text, parameter source/type, read sources, tenant policy, runtime,
artifact digest, entrypoint, semantic plan, or expression dependencies changes
implementation identity and requires deployment review. SQL text is never
returned by public discovery by default. Tooling may expose it only on an
authenticated trusted diagnostics surface.
