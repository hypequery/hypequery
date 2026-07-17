# RFC 0006: Dataset deployment contract

- Status: Proposed
- Version: deployment contract 1

## Summary

This RFC defines the deterministic envelope produced when Hypequery Dataset,
metric, and Serve definitions cross a deployment boundary. It binds the
portable values, identifiers, expressions, schemas, and query implementations
from RFCs 0001 through 0005 into one inspectable contract.

The contract is trusted build output. It contains no credentials, connection
configuration, tenant values, auth callbacks, middleware, source code, or
runtime artifact bytes. Self-hosted Serve does not need to build this envelope.

## Envelope

A deployment has `kind: "hypequery-deployment"`, `version: 1`, and three
closed collections:

- `datasets`: executable semantic Dataset contracts;
- `queries`: named Serve queries with portable schemas and one RFC 0005
  implementation; and
- `artifacts`: the runtime and SHA-256 identity of every runtime artifact
  referenced by a named query.

Names within each collection are unique. Runtime references MUST resolve to an
artifact in the same envelope with the same runtime. Dataset relationships MUST
resolve to another Dataset in the envelope. Compiled SQL input bindings MUST
resolve against the named query input schema, and tenant requirements in an
implementation MUST agree with endpoint policy. Unknown fields fail closed.

## Dataset contract

A Dataset declares its logical name, physical source, tenant policy, optional
time field, dimensions, measures, filters, metrics, relationships, resource
limits, and optional endpoint policy.

Dimensions declare their logical type and one source:

- `column` names a trusted physical column; or
- `sql-expression` embeds the bounded RFC 0005 trusted expression artifact,
  output schema, and compatibility dependencies.

Measures declare their aggregation, input field, optional arg field or
percentile level, optional trusted SQL input expression, and fixed filters as
RFC 0003 expressions. `argMax` and `argMin` require exactly one arg field.
`percentile` requires a finite level in `[0, 1]`. Other aggregations reject
those fields.

Filters declare the logical field and closed operator allow-list. Relationships
declare target Dataset and join fields. `belongsTo` and `hasOne` are queryable;
`hasMany` is metadata-only in version 1 to prevent aggregate fan-out.

Metrics carry their fixed RFC 0003 expression, queryable dimensions and
filters, supported grains, and endpoint policy. A grained metric declares its
fixed grain. Derived metric formulas use the same expression AST and therefore
do not carry source-language callbacks.

## Endpoint policy

Dataset, metric, and named-query endpoints declare whether access is public or
authenticated. Authenticated policies carry exact role and scope requirements.
Every endpoint separately declares tenant context as required, optional, or
not required. Tenant-aware endpoints preserve `auto-inject` or `manual` mode
and the auto-injected column, while tenant extraction remains runtime code.
Endpoints may also declare a positive cache TTL, positive page-size cap, and
route path. Named queries additionally declare their HTTP method.

These fields describe enforcement requirements; authentication strategies,
tenant extraction callbacks, middleware, and HTTP server behavior remain
runtime concerns.

The reference Serve adapter preserves the runtime distinction for explicit
`auth: null`: Dataset and metric entries use it to opt out of a global auth
strategy, while named queries use it only to omit a local strategy and continue
to inherit global auth. Role or scope requirements still make either endpoint
authenticated. Named queries use `requiresAuth: false` for an explicit public
override.

## Serve query adapter

An adapter may convert the portable subset of Zod or Pydantic into RFC 0004
schemas. It MUST reject refinements, transformations, or schema features it
cannot represent without semantic loss. A caller may provide an explicit
portable schema override.

Arbitrary Serve callbacks lower to `runtime-reference`. The build supplies the
runtime artifact digest and stable entrypoint. Fixed semantic plans and safely
compiled SQL may be supplied as explicit implementation overrides. Function
source text, ambient paths, and inferred hashes are prohibited.

## Determinism and compatibility

Reference adapters sort unordered definitions by logical name and return
detached, deeply immutable snapshots. Contract consumers MUST validate the
entire envelope before accepting any contained Dataset or query.

Changes to physical sources, tenant policy, SQL expressions, fields,
aggregations, fixed filters, formulas, relationships, schemas, endpoint access,
implementations, or artifact hashes are deployment-significant. Labels,
descriptions, tags, cache TTLs, limits, and routes are also preserved so build
diffs can distinguish execution changes from presentation and operations.

## Limits

| Limit | Maximum |
| --- | ---: |
| Datasets | 100 |
| Named queries | 1,000 |
| Runtime artifacts | 100 |
| Fields, filters, metrics, relationships, claims, or tags per object | 1,000 |
| Label, description, role, scope, or tag UTF-8 bytes | 4,096 |
| Physical source or column UTF-8 bytes | 1,024 |
| Endpoint path UTF-8 bytes | 2,048 |

Products may lower but not raise these limits while claiming deployment
contract version 1 conformance.

## Stable failure codes

- `HQ_DEPLOYMENT_TYPE`
- `HQ_DEPLOYMENT_UNKNOWN_FIELD`
- `HQ_DEPLOYMENT_INVALID_VERSION`
- `HQ_DEPLOYMENT_INVALID_IDENTIFIER`
- `HQ_DEPLOYMENT_INVALID_VALUE`
- `HQ_DEPLOYMENT_INVALID_REFERENCE`
- `HQ_DEPLOYMENT_TOO_MANY_ITEMS`
- `HQ_DEPLOYMENT_TOO_LARGE`
- `HQ_DEPLOYMENT_UNSAFE_OBJECT`

## Security

Objects with custom prototypes, accessors, symbols, hidden properties, cycles,
sparse arrays, or extra array properties are rejected. SQL remains trusted
build output and is never accepted from caller input. Runtime references can
resolve only inside the containing deployment by digest. The validator returns
a detached, deeply immutable snapshot and performs all cross-reference checks
before the contract is executable.
