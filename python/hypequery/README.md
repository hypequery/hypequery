# hypequery for Python

A Python semantic layer for ClickHouse datasets, metrics, multi-tenant analytics, and FastAPI serving.

> **Pre-alpha:** the protocol foundation and dataset definition API are in place;
> execution and Serve APIs are still being built. Do not use this package in
> production yet.

## Planned install

```bash
pip install hypequery
pip install "hypequery[clickhouse]"
pip install "hypequery[clickhouse-async]"
pip install "hypequery[fastapi]"
```

The SDK is organised as:

- `hypequery.protocol` for the language-neutral artifact contracts;
- `hypequery.datasets` for dimensions, measures, metrics, and relationships;
- `hypequery.execution` for sync and async ClickHouse execution;
- `hypequery.serve` for a strict FastAPI router.

Python and TypeScript implement the same specifications and run against the same conformance fixtures. The goal is identical semantic and deployment artifacts across both languages, not a line-for-line port of the TypeScript runtime.

## Querying datasets

`create_dataset_client` is the entry point for running semantic queries. It
plans each query, hands the compiled statement to an executor, and returns
rows keyed by column name.

```python
from hypequery.datasets import (
    DatasetQuery,
    ExecutionContext,
    create_dataset_client,
    create_dataset_registry,
    eq,
    tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

executor = create_clickhouse_executor(ClickHouseConnection(host="localhost", database="analytics"))
client = create_dataset_client(
    executor=executor, registry=create_dataset_registry(orders, customers)
)

result = client.execute(
    "orders",
    DatasetQuery(
        dimensions=("customer.country",), measures=("revenue",), filters=(eq("status", "paid"),)
    ),
    context=ExecutionContext(tenant=tenant("org_123")),
)
result.data  # ({"customer.country": "NZ", "revenue": "1200.50"}, ...)
result.meta  # query_id, row_count, timing_ms
executor.close()
```

A target is a `Dataset` or the name of a registered dataset. The registry also
resolves relationship targets, so pass one when a query traverses a
relationship. A query can also be a plain mapping (for example a request body);
it is validated strictly and unknown keys are rejected. The tenant always comes
from the trusted `ExecutionContext`, never from the query.

In a request handler, bind the client to the tenant your auth layer resolved
and pass that on instead of the client itself:

```python
scoped = client.for_tenant(tenant(principal.org_id))
scoped.execute("trips", request_body)
```

A tenant-bound client has only `execute`, `validate`, and `to_sql`. Every
query runs as the bound tenant. A context naming a different tenant is refused
with `forbidden` (`HQ_CAPABILITY_TENANT_MISMATCH`). Binding requires exactly
one tenant: `tenants()` with multiple identifiers and `all_tenants()` are
refused, including when constructing a bound client directly.

`client.validate(...)` reports whether a query would plan without running it.
`client.to_sql(...)` returns the redacted debug statement, which has no values
and cannot be executed. For async code, use `create_async_dataset_client` with
an async executor and `await client.execute(...)`. The client does not own the
executor, so close the executor when the application shuts down.

## Result caching

Pass a `ResultCache` to cache results. Keys follow RFC 0009 and RFC 0013: the
store only ever sees opaque `hq1.…` keys, never queries, tenant ids, or filter
values.

```python
from hypequery.datasets import MemoryCacheStore, ResultCache, create_dataset_client

cache = ResultCache(
    store=MemoryCacheStore(max_entries=1_000),
    project="acme",
    environment="production",
    ttl_seconds=60,
)
client = create_dataset_client(executor=executor, registry=registry, cache=cache)
result = client.execute("orders", query, context=context)
result.meta.cache  # "miss", then "hit" for the same request
```

- **Tenant isolation.** Entries are keyed by tenant fingerprint, so two tenants
  never share an entry. Tenant-free, tenant-scoped, and `all_tenants()`
  executions never share one either.
- **Equivalent requests share an entry.** Filter order, `offset: 0`, and empty
  lists do not create separate entries.
- **Never fails a query.** A store error, or a query with no portable form,
  runs uncached and reports `meta.cache == "bypass"`. Pass `use_cache=False`
  to skip the cache for one call.
- **The secret is optional.** Without one, the cache generates a random secret
  for its own lifetime. Keys stay opaque, and entries last as long as the
  process, which is all an in-memory store needs.
- **Shared stores need a secret to share entries.** For a store such as Redis,
  pass `secret=bytes.fromhex(os.environ["HYPEQUERY_CACHE_SECRET"])`: 32+ random
  bytes, the same on every instance, distinct per environment, and never
  shipped. Without one, instances stay isolated from each other, and a warning
  says so. Increment `key_version` when you rotate it.
- **Sharing across runtimes.** Set `definition_identity` to the deployed bundle
  identity to share entries with other runtimes serving the same release.
  Otherwise a digest of the local definitions is used, and any definition
  change starts fresh.

`CacheStore` is a small protocol (`get`, `set`), so a shared store such as
Redis can be plugged in. Stores are called synchronously, including from the
async client.

## Serving with FastAPI

`hypequery.serve` (the `fastapi` extra) provides the router hypequery endpoints
are served from. Every route on it requires authentication unless you
explicitly mark it public:

```python
from typing import Annotated

from fastapi import Depends, FastAPI
from hypequery.serve import Credential, Principal, RequestAuth, create_router


async def authenticate(credential: Credential) -> Principal | None:
    claims = await verify_jwt(credential.value)  # your code
    if claims is None:
        return None
    return Principal(
        subject=claims["sub"],
        scopes=frozenset(claims.get("scope", "").split()),
        tenant_id=claims.get("org_id"),
    )


router = create_router(authenticate=authenticate)


@router.post("/trips")
async def trips(auth: Annotated[RequestAuth, Depends(router.auth)], body: dict) -> dict:
    # Runs as the request's tenant only. A tenant-free request is refused.
    scoped = client.for_tenant(auth.tenant)
    return (await scoped.execute("trips", body)).data


@router.get("/health")
@router.public
def health() -> dict[str, str]:
    return {"status": "ok"}


app = FastAPI()
app.include_router(router)
```

- **Credentials** are read from one header: `Authorization: Bearer <token>`
  by default, or `create_router(credentials=api_key())` for `X-Api-Key`.
  Query strings, cookies, and bodies are never read. A repeated,
  oversized, or malformed header is refused before your authenticator runs.
- **Your authenticator** receives only the opaque `Credential`, never the
  request, and returns a `Principal`. To reject a credential, return `None`
  or raise `InvalidCredential`. Wrap your token library's errors in it:
  anything else that escapes is treated as authentication being down and
  answered with a fixed 503. The exception never reaches the response. The
  authenticator may be sync (run in the threadpool) or async.
- **Authentication runs before the body is read**, so an unauthenticated
  caller cannot make the server parse JSON or spool an upload.
- **The tenant** comes from the principal: `tenant_id` scopes the request, and
  a principal without one is tenant-free. Pass `resolve_tenant=` to decide it
  yourself. A resolver must return a single-tenant scope or `None`; it cannot
  grant `tenants()` with multiple identifiers or `all_tenants()`. No header, query
  parameter, body field, or request state can supply or change the tenant.
- **Public routes** need `@router.public` *below* the route decorator. In the
  other order the route stays authenticated.
- **Routes that would skip authentication are refused.** That covers plain
  Starlette routes, host routes, mounts, static frontends, websockets, and
  `include_router` on this router. Include other routers in the application
  instead. Custom route classes are refused because they could bypass
  authentication before body parsing.
- **Application-level dependencies run first.** Anything passed as
  `FastAPI(dependencies=...)` or `include_router(router, dependencies=...)`
  runs before this router authenticates, so keep those free of work you
  would not do for an anonymous caller.

Every route on the router also has a fixed body policy, applied after
authentication:
- bodies must be UTF-8 `application/json`, otherwise `415`;
- bodies are capped at `create_router(max_body_bytes=...)`, 1 MiB by default,
  and counted as they stream, so a missing `Content-Length` doesn't get
  around the cap;
- a repeated or non-numeric `Content-Length` gets `400`.

Authenticated responses are always sent with `Cache-Control: no-store`.

### HTTP security profile

Wrap the application with `install_http_security`:

```python
from hypequery.serve import CorsPolicy, HttpSecurity, install_http_security

install_http_security(
    app,
    HttpSecurity(
        allowed_hosts=("api.example.com",),
        cors=CorsPolicy(origins=("https://app.example.com",), allow_credentials=True),
        trusted_proxies=("10.0.0.0/8",),
    ),
)
```

- **Hosts.** `allowed_hosts` is required and must name hosts; `*` is refused.
  A request for any other `Host` gets `400` and is never redirected.
- **CORS** is off unless `cors` is set. Origins must be exact
  `scheme://host[:port]` values. Credentialed CORS with `*` fails when the
  policy is built, as do wildcard methods or headers.
- **Proxies.** `X-Forwarded-For` and `X-Forwarded-Proto` are honoured only
  from `trusted_proxies`. The client is the nearest forwarded address that
  isn't itself a trusted proxy. By default no proxy is trusted. A trusted
  proxy must replace a client's `X-Forwarded-Proto` header with the scheme it
  observed; forwarding a caller-supplied value lets the caller spoof it.
- **Request ids.** Every response carries a server-generated `x-request-id`,
  which `request_id(request)` returns inside a handler. A caller's
  `X-Request-ID` is never authoritative. If it is short printable ASCII, it
  is echoed back as `x-correlation-id`; otherwise it is dropped. That covers
  control characters, whitespace, look-alike letters, and values over 200
  bytes.

### Errors

Every error from a served route uses the same envelope as `@hypequery/serve`:

```json
{"error": {"type": "UNAUTHORIZED", "message": "Access denied", "details": {"reason": "missing_credentials"}}}
```

Every error response is sent with `Cache-Control: no-store` and an
`x-request-id`. The shared fixtures in
[`specs/serve-http`](../../specs/serve-http/fixtures/errors-v1/README.md) pin the
envelope for both languages.

- **What an endpoint raises:**
  - `ServeError(status, type, message)` is sent as written, like TypeScript's
    `ServeHttpError`;
  - an `HTTPException` with a string `detail` keeps that message;
  - a `CompiledQueryError` maps its RFC 0010 category to a status and type,
    for example a missed deadline becomes `504 GATEWAY_TIMEOUT`;
  - anything else is logged to the `hypequery.serve` logger with its request
    id and answered with a fixed `500`.

  A server-side failure's own text never reaches the body.
- **Validation errors** are `400 VALIDATION_ERROR` with
  `details.issues[].path`, as in TypeScript, not FastAPI's 422. The submitted
  values are never echoed back.
- **No matching route:** with `install_http_security`, an unknown path or a
  wrong method gets `404 NOT_FOUND`. Your application's own `HTTPException`
  handler, if it registered one first, still handles everything else.

### Rate limiting

Add a `RateLimit` to a route as a dependency:

```python
from fastapi import Depends
from hypequery.serve import RateLimit

@router.post("/trips", dependencies=[Depends(RateLimit(max=60, window_seconds=60))])
async def trips(...): ...
```

It counts each request once. With the default key it runs after authentication
and before the body is read, so a limited caller costs neither a parse nor a
query. Custom `key` callbacks run in FastAPI's dependency order, after body
parsing, so earlier dependencies can prepare `request.state`. Limits declared
after a custom-key limit also retain that order. The defaults
match TypeScript:
- the caller is the authenticated principal, or else the client address, as
  set by `HttpSecurity(trusted_proxies=...)` and never by a header the caller
  chose;
- exhaustion answers `429 RATE_LIMITED` with `Retry-After` and
  `X-RateLimit-*`;
- a store failure lets the request through, or with `fail_open=False`
  answers `503`.

`MemoryRateLimitStore` is bounded, at 100,000 callers by default. When every
slot has an active window, a new caller receives `503` until a slot expires;
active counters are never reset to make room. For several
processes, pass a `store` with an async `hit(key, window_seconds)` method.

## ClickHouse execution

The execution extra accepts `CompiledQuery` objects emitted by the planner.
Values travel through ClickHouse's named server parameters; the SQL statement
retains its typed placeholders. The result codec returns a `QueryRows` object
with stable column order and strict scalar values. Decimal values are strings
so callers do not lose precision.

```python
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

executor = create_clickhouse_executor(ClickHouseConnection(host="localhost", database="analytics"))
rows = executor.execute(compiled_query).named_rows()
executor.close()
```

For async code, install `hypequery[clickhouse-async]` and await
`create_async_clickhouse_executor(connection)` and `executor.execute(compiled_query)`.
Call `await executor.aclose()` when the async executor is no longer needed.
Driver errors are mapped to the canonical safe error categories. Live parameter
tests run in CI against ClickHouse; local execution needs a ClickHouse service.

The async executor limits concurrent queries per client to eight by default.
`ExecutionContext.cancellation` may be a `threading.Event` or `asyncio.Event`;
the planner carries it into the compiled query. Caller cancellation and deadline
expiry issue a separate `KILL QUERY` command using the server query ID. A
cancelled ASGI task is treated as caller cancellation. For a synchronous driver
used inside an async application, `AsyncFromSyncClickHouseExecutor` runs query
work in a bounded worker pool with a separate control worker and supports the
same cancellation contract. During application shutdown, call
`await executor.aclose()` to wait for workers and close both supplied driver
clients. `close()` stops admission immediately without waiting for workers.

## Canonical protocol values

RFC 0001 tagged values and exact RFC 8785 canonical JSON are available from
`hypequery.protocol`:

```python
from hypequery.protocol import encode_canonical_value, integer_value

value = integer_value(42, bits=64, signed=True)
canonical_bytes = encode_canonical_value(value)
```

Python-native `int`, `Decimal`, `date`, timezone-aware `datetime`, `UUID`, and
`bytes` values use explicit constructors so type meaning is fixed before an
artifact is hashed. Validation never calls custom serializers or conversion
hooks.

## Portable identifiers

RFC 0002 simple and qualified logical identifiers are ASCII-only, preserve
their exact spelling, and carry distinct static types after validation:

```python
from hypequery.protocol import (
    parse_protocol_qualified_identifier,
    split_protocol_qualified_identifier,
)

name = parse_protocol_qualified_identifier("orders.customer.country")
segments = split_protocol_qualified_identifier(name)
```

These names are safe protocol nodes, not SQL identifiers, filenames, or URLs;
adapters must still quote or sanitize them for their destination domain.

## Portable expressions

RFC 0003 expression and semantic-query validators return detached, deeply
immutable dataclass models. The function, operator, aggregation, and grain
registries are closed, and products may lower—but not raise—the protocol's
depth, node-count, and collection limits:

```python
from hypequery.protocol import expression_to_data, validate_protocol_expression

expression = validate_protocol_expression(
    {
        "kind": "binary",
        "operator": "divide",
        "left": {"kind": "reference", "name": "revenue"},
        "right": {
            "kind": "call",
            "function": "nullIfZero",
            "args": [{"kind": "reference", "name": "orders"}],
        },
    }
)
portable_data = expression_to_data(expression)
```

Validation accepts strict plain data only. It never invokes mapping hooks,
serializers, callbacks, or arbitrary functions, and raw SQL is not an
expression node.

## SQL portability

SQL-backed dimensions and measures are portable only when their expression
fits the RFC 0003 subset. `compile_portable_sql_expression()` parses that
subset into the validated AST and reports everything else as a located
incompatibility, so a non-portable definition is surfaced rather than executed
with engine-specific meaning:

```python
from hypequery.datasets import compile_portable_sql_expression

result = compile_portable_sql_expression("revenue / nullIfZero(orders)")
if result.portable:
    expression, dependencies = result.expression, result.dependencies
else:
    issue = result.issues[0]  # code, message, and a start/end source span
```

The subset covers identifiers, literals, arithmetic, comparisons, literal `IN`
lists, literal `BETWEEN`, `LIKE`, boolean logic, parentheses, and the approved
formula functions. Statements, subqueries, casts, lambdas, comments, and
unapproved functions are non-portable by construction. Issue codes and source
offsets match `@hypequery/datasets` case for case, enforced by the shared
`sql-portability-v1` fixtures.

## Portable query schemas

RFC 0004 schemas describe the wire values a named query accepts and returns.
They are a closed node vocabulary — no regular expressions, format names,
validators, or callbacks — so a schema survives the trip between runtimes
without carrying executable behaviour:

```python
from hypequery.protocol import validate_protocol_schema

schema = validate_protocol_schema(
    {
        "kind": "object",
        "properties": {
            "limit": {"kind": "integer", "minimum": 1.0, "maximum": 100.0, "default": 10.0},
            "status": {"kind": "enum", "values": ["new", "paid", "shipped"]},
        },
        "required": ["status"],
        "unknownProperties": "reject",
    }
)
```

Validation returns a detached, deeply immutable model. Numbers are binary64
throughout, matching the reference implementation, so bounds and defaults are
written as `1.0` rather than `1`; a width-tagged integer is a *result value*
concept, not an API-schema one. A declared `default` is checked against its own
schema at validation time, and `UNSET` distinguishes an absent default from a
default of `null`.

## Dataset definitions

Definitions use strict, frozen Pydantic models. Helper spellings are Pythonic,
while serialized aggregation and relationship values preserve the same logical
meaning as `@hypequery/datasets`:

```python
from hypequery.datasets import (
    Dataset,
    DatasetLimits,
    belongs_to,
    count,
    count_distinct,
    dimension,
    eq,
    measure,
    sum,
)

Customers = Dataset(
    name="customers",
    source="customers",
    dimensions={"id": dimension("string")},
)

Orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "id": dimension("string"),
        "customerId": dimension("string", column="customer_id"),
        "status": dimension("string"),
        "amount": dimension("number"),
    },
    measures={
        "revenue": measure(sum("amount")),
        "orderCount": measure(count("id")),
        "uniqueCustomers": measure(count_distinct("customerId")),
        "completedRevenue": measure(sum("amount"), filters=(eq("status", "completed"),)),
    },
    relationships={
        "customer": belongs_to(
            lambda: Customers,
            from_field="customerId",
            to_field="id",
        )
    },
    limits=DatasetLimits(max_dimensions=5, max_filters=10),
)
```

Relationship callbacks are invoked once by the helper. Models retain only the
target dataset name, so `model_dump()` and `model_dump_json()` never serialize
Python functions. Formula helpers likewise build immutable symbolic data and
`compile_formula()` lowers that data through the RFC 0003 validator:

```python
from hypequery.datasets import compile_formula, divide, null_if_zero

average = compile_formula(divide("revenue", null_if_zero("orders")))
```

## Deployment contracts

RFC 0006 contracts are the validated, deterministic description of the
datasets managed execution can serve. Named queries, standalone metrics,
runtime artifacts, executable callbacks, credentials, and connection
configuration are all outside the contract — `queries`, `artifacts`, and
dataset `metrics` are invalid even when empty:

```python
from hypequery.protocol import prepare_protocol_deployment_contract

prepared = prepare_protocol_deployment_contract(contract_data)
prepared.canonical  # RFC 8785 JSON text
prepared.identity  # sha256 of "hypequery:deployment:v2\0" + canonical bytes
```

Identity is domain-separated, so a deployment hash cannot collide with another
artifact hashed over the same bytes, and the contract is validated before it is
encoded — identity is only ever computed over something that already passed.

The canonical bytes and hash are byte-identical to `@hypequery/protocol` for
the same contract. A 74-probe differential run across both implementations
found no divergence in acceptance, error code, or identity.

## Bundles and releases

An RFC 0007 bundle manifest describes the content-addressed directory that
transports a deployment contract and any runtime artifacts, binding the
semantic deployment identity to exact file bytes. An RFC 0008 release envelope
assigns one verified bundle to a project and environment:

```python
from hypequery.protocol import (
    prepare_protocol_deployment_bundle_manifest,
    prepare_protocol_deployment_release_envelope,
)

bundle = prepare_protocol_deployment_bundle_manifest(manifest_data)
release = prepare_protocol_deployment_release_envelope(
    {
        "kind": "hypequery-deployment-release",
        "version": 1,
        "bundleIdentity": bundle.identity,
        "target": {"project": "acme", "environment": "production"},
    }
)
```

Each identity is domain-separated, so a bundle hash, a release hash, and a
deployment hash cannot collide even over identical bytes. A release carries no
timestamp or requester: retrying an unchanged envelope produces the same
identity, which is what makes it usable as an idempotency key.

Validation covers the manifest, not the filesystem. Portable paths are checked
for traversal, absolute forms, Windows device names, case-folding collisions,
and ancestors that are themselves declared files — but walking a real
directory, rejecting symlinks and undeclared files, and verifying hashes is a
consumer's job, and those failures are product errors rather than part of this
stable code set.

A manifest with no runtime artifacts is valid: a dataset-only deployment
references none.

Python definitions can now produce that dataset-only bundle directly. Register
every dataset a relationship can reach, and give an endpoint policy only to
datasets that Cloud should expose:

```python
from hypequery.datasets import create_dataset_registry, write_dataset_bundle

registry = create_dataset_registry(Customers, Orders)
bundle = write_dataset_bundle(
    "analytics/hypequery-deployment",
    registry,
    endpoints={
        "orders": {
            "access": {"kind": "authenticated", "roles": ["analyst"], "scopes": []},
            "tenant": {"kind": "required", "mode": "auto-inject", "column": "tenant_id"},
            "path": "/api/analytics/datasets/orders/query",
        }
    },
)
bundle.deployment_identity  # the RFC 0006 identity
bundle.bundle_identity  # the RFC 0007 identity
```

`write_dataset_bundle()` creates `deployment.json` and `bundle.json` in a new
directory and refuses to replace an existing path. `prepare_dataset_bundle()`
returns the same bytes without filesystem I/O. The output carries no Python
source or executable runtime artifact. The definition adapter requires declared
dependencies on SQL-backed fields and validates the full contract before any
file is written. Object-valued measure filter literals are currently rejected
because their map-entry collation is not yet proven byte-identical to the
TypeScript adapter; scalar and array filter values are supported.

## Query events and diagnostics

RFC 0011 defines two metadata-only records about an execution: the query
event, which is safe to emit broadly, and the diagnostics projection, which is
privileged. Validate either before it leaves the process:

```python
from hypequery.protocol import (
    ProtocolQueryEventError,
    validate_protocol_query_diagnostics,
    validate_protocol_query_event,
)

event = validate_protocol_query_event(
    {
        "kind": "hypequery-query-event",
        "version": 1,
        "eventId": event_id,  # 64 lowercase hex characters
        "occurredAt": "2026-10-01T12:00:00.000Z",
        "target": {"project": "acme", "environment": "production"},
        "queryName": "daily_revenue",
        "operation": "query",
        "outcome": "success",
        "durationMs": 182,
    }
)
```

Neither record has a field for rows, parameter values, SQL text, raw tenant
identifiers, or credentials, so an unknown field fails with
`HQ_EVENT_UNKNOWN_FIELD` (or `HQ_DIAGNOSTICS_UNKNOWN_FIELD`) rather than being
dropped. A record from a newer version fails with `*_INVALID_VERSION` even when
it adds fields, so a consumer can skip it. `ProtocolQueryEventLimits` may lower
the free-text byte limits but never raise them.

Validation is all this package does with these records, as in the TypeScript
reference: it does not yet build them from executions. `debugQuery` and
`safeMessage` are free text, so keeping values out of them is the producer's
job; see RFC 0011's producer obligations.

## Registry and catalog

A registry is how datasets are discovered at startup, and how a relationship's
target is resolved — a Python relationship stores only its target's *name*, so
nothing executable is ever held in a definition:

```python
from hypequery.datasets import create_dataset_registry, get_dataset_catalogs

registry = create_dataset_registry(Customers, Orders)
catalogs = get_dataset_catalogs(registry)
```

The catalog is the public, serializable description of a dataset: what can be
grouped, filtered, aggregated, and ordered. It emits the protocol's camelCase
keys and omits absent optionals rather than writing nulls, so the Python
catalog for a model is deep-equal to the `@hypequery/datasets` catalog for the
same model. `specs/semantic-catalog/catalog.json` pins that contract and both
test suites check themselves against it.

Relationship fields follow the query-time rules exactly: `hasMany` contributes
nothing, SQL-backed target dimensions are not joinable, and a `groupable: False`
target dimension stays queryable as a filter while dropping out of
`groupableFields`.

## Semantic contract

The semantic contract is the hashable projection of a registry's catalogs: a
normalized, sorted snapshot with a version marker and a SHA-256 `contentHash`
over its own stable JSON. Two logically equal models hash identically however
they were authored, which is what makes it usable for snapshots, diffs, and CI
drift checks.

```python
from hypequery.datasets import serialize_semantic_contract

trusted = serialize_semantic_contract(registry)
published = serialize_semantic_contract(registry, include_sql=False)
```

`include_sql=False` is the public discovery projection: a SQL-backed dimension
keeps its `sql` in the trusted contract and loses it in the published one, so
serving the contract to untrusted consumers cannot leak internal SQL. The two
projections are deliberately different contracts and hash differently.

Both projections are byte-identical to `@hypequery/datasets` for the same
model. `specs/semantic-catalog/contract.json` and `contract-public.json` pin
that, and both test suites check themselves against them.

## Planning and compiled queries

The planner turns a semantic query into a `CompiledQuery`: the only shape the
package asks a database to execute. SQL text is planner output, values are
named typed parameters, and policy is a closed settings allow-list — so a
request can influence *what* is selected but never *how* it is executed.

```python
from hypequery.datasets.planner import (
    DatasetQuery,
    ExecutionContext,
    plan_dataset_query,
    tenant,
)
from hypequery.datasets.query_helpers import asc, gte

compiled = plan_dataset_query(
    Trips,
    DatasetQuery(
        dimensions=("vendor", "customer.country"),
        measures=("revenue",),
        filters=(gte("pickup", "2026-01-01"),),
        by="day",
        order_by=(asc("period"),),
        limit=100,
    ),
    registry=registry,
    context=ExecutionContext(tenant=tenant("acme")),
)

compiled.sql  # SELECT ... WHERE `pickup_datetime` >= {p0:DateTime64(3)} ...
compiled.parameter_values()  # {"p0": "2026-01-01", "p1": "acme"}
compiled.to_sql()  # the redacted debug form — never executable
```

A dataset that declares a `tenant_key` is not served without a tenant scope:
reading it unscoped returns every tenant's rows, so an absent scope fails
closed with `tenant-required` rather than at whatever consumes the result. A
scope is RFC 0009's tenant capability. Only `tenant()`, `tenants()`, and
`all_tenants()` create one. It is deliberately **not** a Pydantic model, it
cannot be constructed directly, subclassed, or pickled, and its `repr` shows a
tenant count, never a tenant id. `ExecutionContext` rejects anything else in
its `tenant` slot, such as a mapping decoded from a request. Capability
denials carry RFC 0009's stable code on `CompiledQueryError.code`, for
example `HQ_CAPABILITY_TENANT_REQUIRED`; the public envelope from
`failure.to_data()` still carries only the category and message. Joined datasets carry their own tenancy into the join condition rather
than into `WHERE`, where it would silently turn a `LEFT ANY JOIN` into an inner
join. The single-match join also prevents duplicate target keys from
multiplying base rows before aggregation. Filtering the tenant field yourself
is refused while a scope is active.

`to_sql()` is for logs and diagnostics. It shows the same structure with the
same declared types and no values, and its placeholders are `<name:Type>` —
deliberately invalid as ClickHouse SQL, so debug output cannot be pasted into a
client and run.

Two independent checks keep values out of SQL text, and they catch different
things. Ruff's `S608` bans the classic interpolated-statement shape.
`scripts/check_sql_interpolation.py` — which CI runs — catches what `S608`
cannot see, because the planner assembles SQL from fragments that contain no
SQL keyword: it rejects any f-string in the planner that reads caller data, and
then plans the same query twice with different values and asserts the statement
is byte-identical. A deliberately reintroduced interpolation fails the second
check on every axis while `S608` stays green, which is why both are wired up.

Metrics and named queries are deliberately absent from the planner: the Python
definition surface has no metric handles and does not author named queries, so
a branch for either would be unreachable code.

## Development

See the [datasets implementation guide](./ARCHITECTURE.md) for validation,
compilation and client boundaries, and where future dialect work belongs.

```bash
uv sync --all-extras --dev
uv run pytest
uv run mypy
uv run ruff check .
uv run lint-imports
```

From the repository root, run the Python shared-fixture gate with:

```console
pnpm conformance:python
```

This runs both Python adapters — `hypequery.protocol.adapter` for the
protocol families and `hypequery.datasets.adapter` for `sql-portability-v1` —
and asserts each one's exact expected family list before running its cases.
`pnpm conformance` runs this Python gate together with the TypeScript
reference and SQL-portability adapters.

See the [implementation plan](../../plans/python-datasets-serve-pr-level-plan.md) and [security protocol](../../specs/security-protocol/README.md).

For dataset coverage, CI gates, and remaining gaps, see the
[testing review](./TESTING_REVIEW.md).

## Logical discovery and documentation policy

Register `add_discovery_endpoint(router, registry=registry)` to publish a bounded
logical catalog at `/discovery`. It authenticates by default and accepts an
`EndpointPolicy` for role, scope and tenant requirements. Any listed role grants
role access; all listed scopes are required. Explicitly pass
`EndpointPolicy(public=True)` only for intentionally public discovery. The
256 KiB default budget is checked at startup; physical sources, columns, SQL,
tenant policy and tenant values never appear in this projection.

`create_app(router, security=HttpSecurity(allowed_hosts=("analytics.example.com",)))`
disables `/docs`, `/redoc`, and `/openapi.json`. Explicit
`development_docs=True` enables generated development documentation. A host
embedding the router in an existing FastAPI app owns that app's docs policy.
ASGI process configuration remains the separate PYD-06 work.
