"""Pieces every conformance fixture materializer needs.

A compact fixture case names a generator instead of carrying a large literal,
and each family's materializer expands it. They all need the same two things:
a checked integer field, and an object whose contents cannot be read without
executing something — the Python counterpart of a JavaScript accessor. Written
once here so a family cannot quietly grow a weaker version of either.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping


class UnsafeAccessor(Mapping[str, object]):
    """A mapping that fails if a validator ever reads it.

    RFC 0012 requires a validator to refuse an object that computes its own
    contents rather than holding them. In JavaScript that is a property getter;
    in Python it is a custom `Mapping`, which a `type(value) is dict` check
    rejects without ever calling into it. Every method here raises so that a
    validator which did call in fails loudly instead of silently succeeding.
    """

    def __getitem__(self, key: str) -> object:
        raise AssertionError(f"unsafe accessor invoked for {key!r}")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("unsafe iterator invoked")

    def __len__(self) -> int:
        raise AssertionError("unsafe length invoked")


def generator_integer(generator: dict[str, object], key: str) -> int:
    """Read a generator's integer field, defaulting to zero when absent."""

    value = generator.get(key, 0)
    if type(value) is not int:
        raise RuntimeError(f"generator field {key!r} must be an integer")
    return value
