"""Stable public errors for the Hypequery security protocol."""

from __future__ import annotations

from typing import Generic, Literal, NoReturn, TypeAlias, TypeVar

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


ProtocolSchemaErrorCode: TypeAlias = Literal[
    "HQ_SCHEMA_TYPE",
    "HQ_SCHEMA_UNKNOWN_FIELD",
    "HQ_SCHEMA_UNKNOWN_KIND",
    "HQ_SCHEMA_INVALID_IDENTIFIER",
    "HQ_SCHEMA_INVALID_VALUE",
    "HQ_SCHEMA_INVALID_CONSTRAINT",
    "HQ_SCHEMA_INVALID_REQUIRED",
    "HQ_SCHEMA_DUPLICATE_VALUE",
    "HQ_SCHEMA_TOO_DEEP",
    "HQ_SCHEMA_TOO_MANY_NODES",
    "HQ_SCHEMA_TOO_MANY_ITEMS",
    "HQ_SCHEMA_TOO_LARGE",
    "HQ_SCHEMA_UNSAFE_OBJECT",
]


ProtocolQueryImplementationErrorCode: TypeAlias = Literal[
    "HQ_QUERY_IMPLEMENTATION_TYPE",
    "HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD",
    "HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND",
    "HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER",
    "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE",
    "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE",
    "HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS",
    "HQ_QUERY_IMPLEMENTATION_TOO_LARGE",
    "HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT",
]


ProtocolDeploymentErrorCode: TypeAlias = Literal[
    "HQ_DEPLOYMENT_TYPE",
    "HQ_DEPLOYMENT_UNKNOWN_FIELD",
    "HQ_DEPLOYMENT_INVALID_VERSION",
    "HQ_DEPLOYMENT_INVALID_IDENTIFIER",
    "HQ_DEPLOYMENT_INVALID_VALUE",
    "HQ_DEPLOYMENT_INVALID_REFERENCE",
    "HQ_DEPLOYMENT_TOO_MANY_ITEMS",
    "HQ_DEPLOYMENT_TOO_LARGE",
    "HQ_DEPLOYMENT_UNSAFE_OBJECT",
]


ProtocolDeploymentBundleErrorCode: TypeAlias = Literal[
    "HQ_BUNDLE_TYPE",
    "HQ_BUNDLE_UNKNOWN_FIELD",
    "HQ_BUNDLE_INVALID_VERSION",
    "HQ_BUNDLE_INVALID_VALUE",
    "HQ_BUNDLE_INVALID_PATH",
    "HQ_BUNDLE_INVALID_REFERENCE",
    "HQ_BUNDLE_TOO_MANY_ITEMS",
    "HQ_BUNDLE_TOO_LARGE",
    "HQ_BUNDLE_UNSAFE_OBJECT",
]

ProtocolDeploymentReleaseErrorCode: TypeAlias = Literal[
    "HQ_RELEASE_TYPE",
    "HQ_RELEASE_UNKNOWN_FIELD",
    "HQ_RELEASE_INVALID_VERSION",
    "HQ_RELEASE_INVALID_VALUE",
    "HQ_RELEASE_TOO_LARGE",
    "HQ_RELEASE_UNSAFE_OBJECT",
]

ProtocolQueryEventErrorCode: TypeAlias = Literal[
    "HQ_EVENT_TYPE",
    "HQ_EVENT_UNKNOWN_FIELD",
    "HQ_EVENT_INVALID_VERSION",
    "HQ_EVENT_INVALID_VALUE",
    "HQ_EVENT_TOO_LARGE",
    "HQ_EVENT_UNSAFE_OBJECT",
]

ProtocolQueryDiagnosticsErrorCode: TypeAlias = Literal[
    "HQ_DIAGNOSTICS_TYPE",
    "HQ_DIAGNOSTICS_UNKNOWN_FIELD",
    "HQ_DIAGNOSTICS_INVALID_VERSION",
    "HQ_DIAGNOSTICS_INVALID_VALUE",
    "HQ_DIAGNOSTICS_TOO_LARGE",
    "HQ_DIAGNOSTICS_UNSAFE_OBJECT",
]


_Code = TypeVar("_Code", bound=str)


class _ProtocolPathError(TypeError, Generic[_Code]):
    """A stable code and the JSON path it applies to; never the rejected input."""

    code: _Code
    path: str

    def __init__(self, code: _Code, path: str = "$") -> None:
        super().__init__(f"{code} at {path}")
        self.code = code
        self.path = path


class ProtocolValueError(_ProtocolPathError[ProtocolValueErrorCode]):
    """A safe, stable RFC 0001 validation failure."""


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


class ProtocolExpressionError(_ProtocolPathError[ProtocolExpressionErrorCode]):
    """A safe, stable RFC 0003 validation failure."""


def expression_error(code: ProtocolExpressionErrorCode, path: str = "$") -> NoReturn:
    """Raise an expression error without attaching input data to its message."""

    raise ProtocolExpressionError(code, path)


class ProtocolSchemaError(_ProtocolPathError[ProtocolSchemaErrorCode]):
    """A safe, stable RFC 0004 validation failure."""


def schema_error(code: ProtocolSchemaErrorCode, path: str = "$") -> NoReturn:
    """Raise a schema error without attaching input data to its message."""

    raise ProtocolSchemaError(code, path)


class ProtocolQueryImplementationError(_ProtocolPathError[ProtocolQueryImplementationErrorCode]):
    """A safe, stable RFC 0005 validation failure."""


def query_implementation_error(
    code: ProtocolQueryImplementationErrorCode, path: str = "$"
) -> NoReturn:
    """Raise a query-implementation error without attaching input data."""

    raise ProtocolQueryImplementationError(code, path)


class ProtocolDeploymentError(_ProtocolPathError[ProtocolDeploymentErrorCode]):
    """A safe, stable RFC 0006 validation failure."""


def deployment_error(code: ProtocolDeploymentErrorCode, path: str = "$") -> NoReturn:
    """Raise a deployment error without attaching input data to its message."""

    raise ProtocolDeploymentError(code, path)


class ProtocolDeploymentBundleError(_ProtocolPathError[ProtocolDeploymentBundleErrorCode]):
    """A safe, stable RFC 0007 validation failure."""


def bundle_error(code: ProtocolDeploymentBundleErrorCode, path: str = "$") -> NoReturn:
    """Raise a bundle error without attaching input data to its message."""

    raise ProtocolDeploymentBundleError(code, path)


class ProtocolDeploymentReleaseError(_ProtocolPathError[ProtocolDeploymentReleaseErrorCode]):
    """A safe, stable RFC 0008 validation failure."""


def release_error(code: ProtocolDeploymentReleaseErrorCode, path: str = "$") -> NoReturn:
    """Raise a release error without attaching input data to its message."""

    raise ProtocolDeploymentReleaseError(code, path)


class ProtocolQueryEventError(_ProtocolPathError[ProtocolQueryEventErrorCode]):
    """A safe, stable RFC 0011 query event validation failure."""


def event_error(code: ProtocolQueryEventErrorCode, path: str = "$") -> NoReturn:
    """Raise a query event error without attaching input data to its message."""

    raise ProtocolQueryEventError(code, path)


class ProtocolQueryDiagnosticsError(_ProtocolPathError[ProtocolQueryDiagnosticsErrorCode]):
    """A safe, stable RFC 0011 query diagnostics validation failure."""


def diagnostics_error(code: ProtocolQueryDiagnosticsErrorCode, path: str = "$") -> NoReturn:
    """Raise a query diagnostics error without attaching input data to its message."""

    raise ProtocolQueryDiagnosticsError(code, path)
