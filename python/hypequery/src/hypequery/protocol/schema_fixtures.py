"""Language-neutral materializers for compact RFC 0004 conformance cases."""

from __future__ import annotations

from collections.abc import Iterator, Mapping

from .wire_numbers import to_binary64_tree


class _UnsafeSchemaAccessor(Mapping[str, object]):
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


def materialize_schema_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the query-schemas-v1 fixture README."""

    kind = generator.get("type")
    if kind == "nested-array":
        value: object = {"kind": "any"}
        for _ in range(_integer(generator, "depth")):
            value = {"kind": "array", "items": value}
        return value
    if kind == "union-tree":
        return {
            "kind": "union",
            "variants": [
                {"kind": "union", "variants": [{"kind": "any"} for _ in range(100)]}
                for _ in range(10)
            ],
        }
    if kind == "enum-values":
        return {
            "kind": "enum",
            "values": [f"v{index}" for index in range(_integer(generator, "count"))],
        }
    if kind == "description":
        return {"kind": "string", "description": "a" * _integer(generator, "bytes")}
    if kind == "unsafe-accessor":
        return _UnsafeSchemaAccessor()
    raise RuntimeError(f"unknown schema generator: {kind!r}")


def normalize_schema_wire_numbers(value: object) -> object:
    """Restore binary64 semantics for every JSON number in a schema tree.

    Schema numbers are all binary64 in the reference implementation — bounds,
    literal and enum values, and defaults alike — so the whole tree converts,
    unlike an expression where only literal positions do.
    """

    return to_binary64_tree(value)
