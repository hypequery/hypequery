"""Binary64 recovery for fixture JSON that has crossed the wire.

The conformance runner speaks JSON, which has one number type. JavaScript
reads every one of them back as a binary64 double; Python's decoder splits
them into ``int`` and ``float``. A Python ``int`` at a value position means
something different in the protocol — it needs an explicit width tag — so
fixture input has to be put back into binary64 terms before validation, or
Python would reject cases the shared corpus expects it to accept.
"""

from __future__ import annotations


def to_binary64_tree(value: object) -> object:
    """Recursively re-read every JSON integer in *value* as a binary64 float."""

    if type(value) is int:
        return float(value)
    if type(value) is list:
        return [to_binary64_tree(item) for item in value]
    if type(value) is dict:
        return {key: to_binary64_tree(item) for key, item in value.items()}
    return value
