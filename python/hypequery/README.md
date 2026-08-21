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

## Development

```bash
uv sync --all-extras --dev
uv run pytest
uv run mypy
uv run ruff check .
uv run lint-imports
```

See the [implementation plan](../../plans/python-datasets-serve-pr-level-plan.md) and [security protocol](../../specs/security-protocol/README.md).
