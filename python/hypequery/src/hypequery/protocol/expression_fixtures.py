"""Language-neutral materializers for compact RFC 0003 conformance cases."""

from __future__ import annotations

from .fixture_primitives import UnsafeAccessor, generator_integer
from .wire_numbers import to_binary64_tree


def materialize_expression_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the expressions-v1 or -v2 fixture README."""

    kind = generator.get("type")
    literal = {"kind": "literal", "value": False}
    if kind == "nested-not":
        value: object = literal
        for _ in range(generator_integer(generator, "depth")):
            value = {"kind": "logical", "operator": "not", "operand": value}
        return value
    if kind == "logical-operands":
        return {
            "kind": "logical",
            "operator": "and",
            "operands": [dict(literal) for _ in range(generator_integer(generator, "count"))],
        }
    if kind == "logical-tree":
        groups: list[object] = []
        for group_index in range(10):
            size = 100 if group_index < 9 else generator_integer(generator, "lastGroupItems")
            groups.append(
                {
                    "kind": "logical",
                    "operator": "and",
                    "operands": [dict(literal) for _ in range(size)],
                }
            )
        return {"kind": "logical", "operator": "and", "operands": groups}
    if kind == "segments":
        count = generator_integer(generator, "count")
        return {
            "kind": "dataset",
            "dataset": "orders",
            "segments": [f"s{index}" for index in range(count)],
        }
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    raise RuntimeError(f"unknown expression generator: {kind!r}")


def normalize_expression_wire_numbers(value: object) -> object:
    """Restore binary64 semantics for JSON numbers inside literal nodes."""

    if type(value) is list:
        return [normalize_expression_wire_numbers(item) for item in value]
    if type(value) is not dict:
        return value
    literal = value.get("kind") == "literal"
    return {
        key: (
            to_binary64_tree(item)
            if literal and key == "value"
            else normalize_expression_wire_numbers(item)
        )
        for key, item in value.items()
    }
