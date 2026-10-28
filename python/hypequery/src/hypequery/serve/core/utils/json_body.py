"""JSON bodies: rendered as Starlette's `JSONResponse` does, parsed as `JSON.parse` does."""

from __future__ import annotations

import json
from typing import NoReturn


def render_json(value: object) -> bytes:
    """Compact UTF-8 JSON; NaN and infinities are refused rather than emitted."""

    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")
    ).encode("utf-8")


def _refuse_constant(name: str) -> NoReturn:
    raise ValueError(f"{name} is not JSON")


def parse_json(data: bytes) -> object:
    """Parse *data* as JavaScript's `JSON.parse` would.

    Python's `json` also reads `NaN`, `Infinity` and `-Infinity`, which are not
    JSON; they are refused. Raises ValueError (or RecursionError) when *data*
    is not JSON.
    """

    return json.loads(data, parse_constant=_refuse_constant)
