# hypequery for Python

A Python semantic layer for ClickHouse datasets, metrics, multi-tenant analytics, and FastAPI serving.

> **Pre-alpha:** the protocol foundation and dataset definition API are in place;
> execution and Serve APIs are still being built. Do not use this package in
> production yet.

## Planned install

```bash
pip install hypequery
pip install "hypequery[clickhouse]"
pip install "hypequery[fastapi]"
```

The SDK is organised as:

- `hypequery.protocol` for the language-neutral artifact contracts;
- `hypequery.datasets` for dimensions, measures, metrics, and relationships;
- `hypequery.serve` for a strict FastAPI router.

Python and TypeScript implement the same specifications and run against the same conformance fixtures. The goal is identical semantic and deployment artifacts across both languages, not a line-for-line port of the TypeScript runtime.

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

This command asserts the adapter's exact expected family list before running
the cases. `pnpm conformance` runs this Python gate together with the
TypeScript reference and SQL-portability adapters.

See the [implementation plan](../../plans/python-datasets-serve-pr-level-plan.md) and [security protocol](../../specs/security-protocol/README.md).
