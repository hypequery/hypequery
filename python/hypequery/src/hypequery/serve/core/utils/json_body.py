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


def parse_json(data: bytes | str) -> object:
    """Parse *data* as JavaScript's `JSON.parse` would.

    Python's `json` also reads `NaN`, `Infinity` and `-Infinity`, which are not
    JSON; they are refused. Raises ValueError (or RecursionError) when *data*
    is not JSON.
    """

    return json.loads(data, parse_constant=_refuse_constant)


#: Deeper than any request a client sends. Validators walk a decoded body
#: recursively, so a body nested past the interpreter's recursion limit would
#: fail as a server error, logging a thousand-frame traceback per request.
MAX_BODY_DEPTH = 64


class BodyJsonError(ValueError):
    """A request body that is not JSON a handler can use; *reason* says why."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def parse_body_json(data: bytes) -> object:
    """A request body, parsed as `JSON.parse` reads a UTF-8 body, and bounded.

    Bytes that are not UTF-8 raise `UnicodeDecodeError` (Python's `json` would
    instead guess UTF-16 or UTF-32), and malformed JSON `json.JSONDecodeError`.
    `BodyJsonError` refuses what `json` accepts but no handler can use: `NaN`
    and `Infinity`, a string holding a lone surrogate such as ``"\\ud800"``,
    which no UTF-8 encoder, and so no database driver, can send on, and nesting
    deeper than `MAX_BODY_DEPTH`.
    """

    text = data.decode("utf-8")
    try:
        value = parse_json(text)
    except json.JSONDecodeError:
        raise
    except RecursionError:
        raise BodyJsonError("nested too deeply") from None
    except ValueError as exc:
        # NaN, Infinity or -Infinity.
        raise BodyJsonError(str(exc)) from None
    _check_depth_and_text(value)
    return value


def _check_depth_and_text(value: object) -> None:
    pending: list[tuple[object, int]] = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if type(item) is str:
            _check_text(item)
        elif type(item) is list or type(item) is dict:
            if depth >= MAX_BODY_DEPTH:
                raise BodyJsonError("nested too deeply")
            if type(item) is dict:
                for key in item:
                    _check_text(key)
                pending.extend((member, depth + 1) for member in item.values())
            else:
                pending.extend((member, depth + 1) for member in item)


def _check_text(text: str) -> None:
    if not text.isascii():
        try:
            text.encode("utf-8")
        except UnicodeEncodeError:
            raise BodyJsonError("a string is not valid Unicode") from None
