"""Language-neutral materializers for compact RFC 0004 conformance cases."""

from __future__ import annotations

from .fixture_primitives import UnsafeAccessor, generator_integer
from .wire_numbers import to_binary64_tree


def materialize_schema_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the query-schemas-v1 fixture README."""

    kind = generator.get("type")
    if kind == "nested-array":
        value: object = {"kind": "any"}
        for _ in range(generator_integer(generator, "depth")):
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
            "values": [f"v{index}" for index in range(generator_integer(generator, "count"))],
        }
    if kind == "description":
        return {"kind": "string", "description": "a" * generator_integer(generator, "bytes")}
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    raise RuntimeError(f"unknown schema generator: {kind!r}")


def normalize_schema_wire_numbers(value: object) -> object:
    """Restore binary64 semantics for every JSON number in a schema tree.

    Schema numbers are all binary64 in the reference implementation — bounds,
    literal and enum values, and defaults alike — so the whole tree converts,
    unlike an expression where only literal positions do.
    """

    return to_binary64_tree(value)
