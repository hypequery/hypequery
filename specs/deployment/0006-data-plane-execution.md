# Deployment runtime 0006: Data-plane execution

- Status: Proposed
- Version: deployment data plane 1

## Summary

This specification defines provider-neutral execution of named-query endpoints
from one immutable deployment contract. It covers exact route selection,
portable schema application, access and tenant policy, implementation dispatch,
typed compiled-SQL bindings, output validation, cancellation, and stable failure
classification.

HTTP transport adaptation and active-generation host assembly are separate. A
host constructs a data plane from the same immutable activation generation it
uses for supervised runtime dispatch.

## Route selection

Named-query routes are keyed by the exact uppercase method and absolute path in
the deployment contract. Deployment validation rejects two named queries with
the same method and path. A path with another declared method is a method
mismatch; an undeclared path is not found.

The version 1 executor does not normalize paths, decode URL components, or
remove query strings. Transport adapters perform those operations before
calling the provider-neutral executor.

## Schema application

Input is detached and bounded before execution. Schema application:

- accepts only finite JSON-compatible values and safe plain object graphs;
- rejects accessors, symbols, custom prototypes, cycles, sparse arrays, and
  values over configured depth, node, collection, or string limits;
- applies schema defaults;
- implements object `reject`, `strip`, and `preserve` behavior;
- returns immutable arrays and null-prototype objects;
- requires `undefined` only for `void` schemas.

The executor applies the output schema after implementation execution. Invalid
output is an internal contract failure and is never returned to a caller.

## Access and tenant policy

Authenticated endpoints require a principal. Required roles and scopes use
all-of semantics. Authentication provider exceptions fail closed without
exposing their details.

Required and optional tenant policies call the configured tenant resolver. A
required policy rejects an absent or null tenant. The resolved tenant is passed
to every implementation adapter. `auto-inject` versus `manual` behavior is
implemented by the native semantic or runtime adapter; the core executor does
not infer a database predicate.

## Implementation dispatch

Exactly one adapter handles each implementation kind:

- `semantic-plan` receives the fixed plan and immutable deployment contract;
- `compiled-sql` receives the fixed statement plus a closed parameter record;
- `runtime-reference` receives the validated execution context and exact
  runtime reference.

Compiled SQL parameter records are built only from declared input paths and the
resolved tenant. Missing values fail before the SQL adapter runs. Adapters must
use the declared ClickHouse parameter types and must not interpolate values into
the fixed statement.

The runtime-supervisor adapter pins every invocation to the activation revision
used to construct the data plane. The supervisor rejects a call when another
generation is active, preventing a route and schema from one activation from
invoking the same query name in another activation. The host supplies an
explicit argument mapper because Node, Python, and remote runtimes may expose
different handler argument contracts.

## Cancellation and failures

Cancellation is checked before policy work, after asynchronous authentication
and tenant resolution, and around implementation execution. If a signal aborts
while an adapter fails, cancellation wins.

Stable data-plane failure codes are:

- `HQ_DATA_PLANE_CONFIGURATION`
- `HQ_DATA_PLANE_ROUTE_NOT_FOUND`
- `HQ_DATA_PLANE_METHOD_NOT_ALLOWED`
- `HQ_DATA_PLANE_UNAUTHENTICATED`
- `HQ_DATA_PLANE_FORBIDDEN`
- `HQ_DATA_PLANE_TENANT_REQUIRED`
- `HQ_DATA_PLANE_INPUT_INVALID`
- `HQ_DATA_PLANE_OUTPUT_INVALID`
- `HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE`
- `HQ_DATA_PLANE_EXECUTION_FAILED`
- `HQ_DATA_PLANE_ABORTED`

Input and output schema failures may include a bounded structural path. Provider
exceptions remain available as error causes for trusted telemetry but must not
be exposed by public transport adapters.

## Out of scope

Version 1 does not define HTTP body parsing or response mapping, dynamic Dataset
and metric endpoints, native semantic-plan execution, ClickHouse client
selection, Serve runtime argument construction, automatic reconciliation,
rollback, retention, distributed routing, rate limiting, or telemetry export.
