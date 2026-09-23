"""Language-neutral materializers for compact RFC 0005 conformance cases."""

from __future__ import annotations

from .fixture_primitives import UnsafeAccessor, generator_integer


def _compiled_sql(parameters: list[object]) -> dict[str, object]:
    return {
        "kind": "compiled-sql",
        "dialect": "clickhouse",
        "operation": "select",
        "statement": "SELECT 1",
        "parameters": parameters,
        "readSources": [],
        "tenant": {"kind": "not-required"},
    }


def materialize_implementation_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the query-implementations-v1 README."""

    kind = generator.get("type")
    if kind == "parameters":
        return _compiled_sql(
            [
                {
                    "name": f"param{index}",
                    "source": {"kind": "input", "path": f"param{index}"},
                    "clickHouseType": "String",
                }
                for index in range(generator_integer(generator, "count"))
            ]
        )
    if kind == "sql-expression":
        return {
            "kind": "sql-expression",
            "dialect": "clickhouse",
            "sql": "a" * generator_integer(generator, "bytes"),
            "output": {"kind": "string"},
            "dependencies": [],
        }
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    raise RuntimeError(f"unknown implementation generator: {kind!r}")
