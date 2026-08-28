"""Stable public errors for the Hypequery value protocol."""

from __future__ import annotations

from typing import Literal, NoReturn, TypeAlias

ProtocolValueErrorCode: TypeAlias = Literal[
    "HQ_VALUE_INVALID_JSON",
    "HQ_VALUE_DUPLICATE_KEY",
    "HQ_VALUE_INVALID_UNICODE",
    "HQ_VALUE_CONTROL_CHARACTER",
    "HQ_VALUE_NON_FINITE_FLOAT",
    "HQ_VALUE_NEGATIVE_ZERO",
    "HQ_VALUE_INTEGER_TAG_REQUIRED",
    "HQ_VALUE_RAW_COMPOSITE",
    "HQ_VALUE_UNKNOWN_TAG",
    "HQ_VALUE_UNKNOWN_TAG_VERSION",
    "HQ_VALUE_UNKNOWN_FIELD",
    "HQ_VALUE_INVALID_FORMAT",
    "HQ_VALUE_OUT_OF_RANGE",
    "HQ_VALUE_TYPE_MISMATCH",
    "HQ_VALUE_TOO_DEEP",
    "HQ_VALUE_TOO_MANY_NODES",
    "HQ_VALUE_TOO_MANY_ITEMS",
    "HQ_VALUE_TOO_LARGE",
    "HQ_VALUE_UNSAFE_OBJECT",
]


class ProtocolValueError(TypeError):
    """A safe, stable RFC 0001 validation failure."""

    code: ProtocolValueErrorCode
    path: str

    def __init__(self, code: ProtocolValueErrorCode, path: str = "$") -> None:
        super().__init__(f"{code} at {path}")
        self.code = code
        self.path = path


def value_error(code: ProtocolValueErrorCode, path: str = "$") -> NoReturn:
    """Raise a protocol error without attaching input data to its message."""

    raise ProtocolValueError(code, path)
