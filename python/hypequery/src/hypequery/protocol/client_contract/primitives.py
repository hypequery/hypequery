"""Closed shapes and portable descriptor primitives."""

from __future__ import annotations

import re
from typing import cast

from ..identifiers import parse_protocol_identifier
from ..js_strings import is_js_blank
from ..utf8 import exceeds_utf8_byte_limit
from .errors import client_error
from .timezone_names import CLIENT_TIMEZONE_NAMES

FIELD_TYPES = ["string", "number", "boolean", "timestamp"]
GRAINS = ["minute", "hour", "day", "week", "month", "quarter", "year"]
OPERATORS = [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "notIn",
    "between",
    "like",
    "isNull",
    "isNotNull",
]
#: Operators that test a field for NULL and carry no value (RFC 0023).
NULL_CHECK_OPERATORS = ("isNull", "isNotNull")


def pointer(path: str, key: str | int) -> str:
    return path + "/" + str(key).replace("~", "~0").replace("/", "~1")


def record(value: object, path: str) -> dict[str, object]:
    if type(value) is not dict:
        client_error("HQ_CLIENT_SHAPE", path)
    return cast(dict[str, object], value)


def shape(value: object, keys: list[str], path: str) -> dict[str, object]:
    output = record(value, path)
    if any(key not in keys for key in output):
        client_error("HQ_CLIENT_UNKNOWN_FIELD", path)
    if any(key not in output for key in keys):
        client_error("HQ_CLIENT_SHAPE", path)
    return output


def optional_shape(value: object, keys: list[str], path: str) -> dict[str, object]:
    """A closed object whose listed members are all optional; at least one is required."""
    output = record(value, path)
    if any(key not in keys for key in output):
        client_error("HQ_CLIENT_UNKNOWN_FIELD", path)
    if not any(key in output for key in keys):
        client_error("HQ_CLIENT_SHAPE", path)
    return output


def text(value: object, path: str) -> str:
    """Deployment label/description rules: non-blank, control-free, at most 4096 UTF-8 bytes."""
    if type(value) is not str or is_js_blank(value) or len(value) > 4096:
        client_error("HQ_CLIENT_SHAPE", path)
    if any(ord(c) <= 0x1F or 0x7F <= ord(c) <= 0x9F for c in value):
        client_error("HQ_CLIENT_SHAPE", path)
    if exceeds_utf8_byte_limit(value, 4096):
        client_error("HQ_CLIENT_SHAPE", path)
    return value


def choice(value: object, choices: list[str], path: str) -> str:
    if type(value) is not str or value not in choices:
        client_error("HQ_CLIENT_SHAPE", path)
    return value


def boolean(value: object, path: str) -> bool:
    if type(value) is not bool:
        client_error("HQ_CLIENT_SHAPE", path)
    return value


def integer(value: object, low: int, high: int, path: str) -> int:
    if type(value) not in (int, float):
        client_error("HQ_CLIENT_SHAPE", path)
    number = cast("int | float", value)
    if not low <= number <= high or number != int(number):
        client_error("HQ_CLIENT_SHAPE", path)
    return int(number)


def name(value: object, path: str, *, qualified: bool = False) -> str:
    if type(value) is not str:
        client_error("HQ_CLIENT_IDENTIFIER", path)
    result = value
    parts = result.split(".")
    if len(parts) > (2 if qualified else 1):
        client_error("HQ_CLIENT_IDENTIFIER", path)
    try:
        for part in parts:
            parse_protocol_identifier(part)
    except (TypeError, ValueError):
        client_error("HQ_CLIENT_IDENTIFIER", path)
    return result


def names(value: object, path: str, allowed: list[str] | None = None) -> list[str]:
    if type(value) is not list:
        client_error("HQ_CLIENT_SHAPE", path)
    result = [
        name(item, pointer(path, index), qualified=True)
        if allowed is None
        else choice(item, allowed, pointer(path, index))
        for index, item in enumerate(cast(list[object], value))
    ]
    if len(set(result)) != len(result):
        client_error("HQ_CLIENT_DUPLICATE", path)
    return result


def route(value: object, path: str) -> str:
    if type(value) is not str:
        client_error("HQ_CLIENT_PATH", path)
    result = value
    if not re.fullmatch(r"/(?:[A-Za-z0-9_~.-]+/)*[A-Za-z0-9_~.-]+", result) or any(
        part in (".", "..") for part in result.split("/")
    ):
        client_error("HQ_CLIENT_PATH", path)
    return result


def timezone(value: object, path: str) -> str:
    if type(value) is not str or value not in CLIENT_TIMEZONE_NAMES:
        client_error("HQ_CLIENT_SHAPE", path)
    return value
