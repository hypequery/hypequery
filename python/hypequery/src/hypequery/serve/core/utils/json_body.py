"""JSON response bodies, rendered byte-for-byte as Starlette's `JSONResponse` does."""

from __future__ import annotations

import json


def render_json(value: object) -> bytes:
    """Compact UTF-8 JSON; NaN and infinities are refused rather than emitted."""

    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")
    ).encode("utf-8")
