# hypequery for Python

A Python semantic layer for ClickHouse datasets, metrics, multi-tenant analytics, and FastAPI serving.

> **Pre-alpha:** the package structure and protocol foundation are in place; the public datasets and Serve APIs are still being built. Do not use this package in production yet.

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

## Development

```bash
uv sync --all-extras --dev
uv run pytest
uv run mypy
uv run ruff check .
uv run lint-imports
```

From the repository root, run the shared cross-language gate with:

```bash
node packages/protocol-conformance/dist/bin/conformance.js run \
  --fixtures specs/security-protocol/fixtures \
  --families tagged-values-v1,identifiers-v1 \
  -- uv run --project python/hypequery python -m hypequery.protocol.adapter
```

See the [implementation plan](../../plans/python-datasets-serve-pr-level-plan.md) and [security protocol](../../specs/security-protocol/README.md).
