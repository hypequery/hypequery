"""Language-neutral materializers for compact RFC 0003 conformance cases."""

from __future__ import annotations

from collections.abc import Iterator, Mapping


class _UnsafeExpressionAccessor(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError(f"unsafe accessor invoked for {key!r}")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("unsafe iterator invoked")

    def __len__(self) -> int:
        raise AssertionError("unsafe length invoked")


def _integer(generator: dict[str, object], key: str) -> int:
    value = generator.get(key, 0)
    if type(value) is not int:
        raise RuntimeError(f"generator field {key!r} must be an integer")
    return value


def materialize_expression_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the expressions-v1 fixture README."""

    kind = generator.get("type")
    literal = {"kind": "literal", "value": False}
    if kind == "nested-not":
        value: object = literal
        for _ in range(_integer(generator, "depth")):
            value = {"kind": "logical", "operator": "not", "operand": value}
        return value
    if kind == "logical-operands":
        return {
            "kind": "logical",
            "operator": "and",
            "operands": [dict(literal) for _ in range(_integer(generator, "count"))],
        }
    if kind == "logical-tree":
        groups: list[object] = []
        for group_index in range(10):
            size = 100 if group_index < 9 else _integer(generator, "lastGroupItems")
            groups.append(
                {
                    "kind": "logical",
                    "operator": "and",
                    "operands": [dict(literal) for _ in range(size)],
                }
            )
        return {"kind": "logical", "operator": "and", "operands": groups}
    if kind == "unsafe-accessor":
        return _UnsafeExpressionAccessor()
    raise RuntimeError(f"unknown expression generator: {kind!r}")


def _binary64_tree(value: object) -> object:
    if type(value) is int:
        return float(value)
    if type(value) is list:
        return [_binary64_tree(item) for item in value]
    if type(value) is dict:
        return {key: _binary64_tree(item) for key, item in value.items()}
    return value


def normalize_expression_wire_numbers(value: object) -> object:
    """Restore binary64 semantics for JSON numbers inside literal nodes."""

    if type(value) is list:
        return [normalize_expression_wire_numbers(item) for item in value]
    if type(value) is not dict:
        return value
    literal = value.get("kind") == "literal"
    return {
        key: (
            _binary64_tree(item)
            if literal and key == "value"
            else normalize_expression_wire_numbers(item)
        )
        for key, item in value.items()
    }
