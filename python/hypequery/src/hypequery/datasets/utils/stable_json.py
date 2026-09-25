"""Pretty JSON with ECMAScript number spelling for semantic contract hashes."""

from __future__ import annotations

import json
from typing import cast

from hypequery.protocol._jcs import serialize_number


def stable_json(value: object, depth: int = 0) -> str:
    """Match JSON.stringify's two-space layout without changing key order."""

    if type(value) is float:
        number = value
        return "0" if number == 0 else serialize_number(number)
    if type(value) is dict:
        entries = cast(dict[str, object], value)
        if not entries:
            return "{}"
        items = [
            f"{json.dumps(key, ensure_ascii=False)}: {stable_json(item, depth + 1)}"
            for key, item in entries.items()
        ]
        opening, closing = "{", "}"
    elif type(value) is list:
        values = cast(list[object], value)
        if not values:
            return "[]"
        items = [stable_json(item, depth + 1) for item in values]
        opening, closing = "[", "]"
    else:
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    indentation = "  " * (depth + 1)
    return (
        opening
        + "\n"
        + indentation
        + (",\n" + indentation).join(items)
        + "\n"
        + "  " * depth
        + closing
    )
