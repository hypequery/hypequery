"""Stable public errors for the Hypequery security protocol."""

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

ProtocolIdentifierErrorCode: TypeAlias = Literal[
    "HQ_IDENTIFIER_TYPE",
    "HQ_IDENTIFIER_EMPTY",
    "HQ_IDENTIFIER_TOO_LONG",
    "HQ_IDENTIFIER_INVALID_FORMAT",
    "HQ_IDENTIFIER_RESERVED",
    "HQ_IDENTIFIER_TOO_MANY_SEGMENTS",
]

ProtocolExpressionErrorCode: TypeAlias = Literal[
    "HQ_EXPRESSION_TYPE",
    "HQ_EXPRESSION_UNKNOWN_FIELD",
    "HQ_EXPRESSION_UNKNOWN_KIND",
    "HQ_EXPRESSION_INVALID_IDENTIFIER",
    "HQ_EXPRESSION_INVALID_VALUE",
    "HQ_EXPRESSION_INVALID_OPERATOR",
    "HQ_EXPRESSION_INVALID_ARITY",
    "HQ_EXPRESSION_INVALID_AGGREGATION",
    "HQ_EXPRESSION_INVALID_QUERY",
    "HQ_EXPRESSION_TOO_DEEP",
    "HQ_EXPRESSION_TOO_MANY_NODES",
    "HQ_EXPRESSION_TOO_MANY_ITEMS",
    "HQ_EXPRESSION_UNSAFE_OBJECT",
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


class ProtocolIdentifierError(TypeError):
    """A safe, stable RFC 0002 validation failure."""

    code: ProtocolIdentifierErrorCode

    def __init__(self, code: ProtocolIdentifierErrorCode) -> None:
        super().__init__(code)
        self.code = code


def identifier_error(code: ProtocolIdentifierErrorCode) -> NoReturn:
    """Raise an identifier error without attaching the rejected input."""

    raise ProtocolIdentifierError(code)


class ProtocolExpressionError(TypeError):
    """A safe, stable RFC 0003 validation failure."""

    code: ProtocolExpressionErrorCode
    path: str

    def __init__(self, code: ProtocolExpressionErrorCode, path: str = "$") -> None:
        super().__init__(f"{code} at {path}")
        self.code = code
        self.path = path


def expression_error(code: ProtocolExpressionErrorCode, path: str = "$") -> NoReturn:
    """Raise an expression error without attaching input data to its message."""

    raise ProtocolExpressionError(code, path)
