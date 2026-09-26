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
scope is created by `tenant()`, `tenants()`, or `all_tenants()` and is
deliberately **not** a Pydantic model, so no request body can be coerced into
one. Joined datasets carry their own tenancy into the join condition rather
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
