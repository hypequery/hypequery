"""Match JavaScript localeCompare ordering for RFC 0002 ASCII names.

The TypeScript deployment adapter sorts logical names with localeCompare.
RFC 0002 names contain only ASCII letters, digits, and underscores, so this
small fixed collation gives Python the same order without a locale dependency.
"""

from __future__ import annotations


def portable_name_key(value: str) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Sort underscore, digits, then letters; lowercase precedes uppercase."""

    base: list[int] = []
    case: list[int] = []
    for char in value:
        if char == "_":
            base.append(0)
            case.append(0)
        elif "0" <= char <= "9":
            base.append(ord(char) - ord("0") + 1)
            case.append(0)
        else:
            base.append(ord(char.lower()) - ord("a") + 11)
            case.append(0 if char.islower() else 1)
    return tuple(base), tuple(case)
