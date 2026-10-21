"""Pretty JSON with ECMAScript number spelling for semantic contract hashes."""

from __future__ import annotations

import json
from typing import cast

from hypequery.protocol import serialize_protocol_number, serialize_protocol_string


def stable_json(value: object, depth: int = 0) -> str:
    """Match JSON.stringify's two-space layout without changing key order."""

    if type(value) is float:
        number = value
        return "0" if number == 0 else serialize_protocol_number(number)
    if type(value) is dict:
        entries = cast(dict[str, object], value)
        if not entries:
            return "{}"
        items = [
            f"{serialize_protocol_string(key)}: {stable_json(item, depth + 1)}"
            for key, item in entries.items()
        ]
        opening, closing = "{", "}"
    elif type(value) is list:
        values = cast(list[object], value)
        if not values:
            return "[]"
        items = [stable_json(item, depth + 1) for item in values]
        opening, closing = "[", "]"
    elif type(value) is str:
        # JSON.stringify writes a lone surrogate as an escape, so the text
        # always encodes as UTF-8 and hashes as TypeScript's does.
        return serialize_protocol_string(value)
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
