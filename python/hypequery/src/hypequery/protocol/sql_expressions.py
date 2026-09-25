"""RFC 0005 SQL expression validation.

A SQL-backed dataset field and a named-query implementation carry the same
shape: trusted-local SQL text, the schema of what it produces, and the logical
identifiers it reads. It is trusted because an author wrote it during a build,
never because it was checked — this validator bounds and structures it, it does
not parse or sanitize SQL. Anything portable goes through the expression AST
instead.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Literal, cast

from .errors import (
    ProtocolIdentifierError,
    ProtocolSchemaError,
    query_implementation_error,
)
from .identifiers import ProtocolQualifiedIdentifier, parse_protocol_qualified_identifier
from .schema_models import ProtocolSchema, schema_to_data
from .schemas import validate_protocol_schema
from .utf8 import exceeds_utf8_byte_limit

_QUERY_IMPLEMENTATION_MAXIMUMS = {
    "max_statement_bytes": 1_048_576,
    "max_expression_bytes": 65_536,
    "max_type_bytes": 256,
    "max_source_bytes": 1_024,
    "max_collection_items": 100,
}


@dataclass(frozen=True, slots=True)
class ProtocolQueryImplementationLimits:
    """Product limits that may lower, but never raise, RFC 0005 limits."""

    max_statement_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_statement_bytes"]
    max_expression_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_expression_bytes"]
    max_type_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_type_bytes"]
    max_source_bytes: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_source_bytes"]
    max_collection_items: int = _QUERY_IMPLEMENTATION_MAXIMUMS["max_collection_items"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _QUERY_IMPLEMENTATION_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the protocol v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS = ProtocolQueryImplementationLimits()


@dataclass(frozen=True, slots=True)
class ProtocolSqlExpression:
    """Trusted-local SQL, the schema it produces, and the fields it reads."""

    sql: str
    output: ProtocolSchema
    dependencies: tuple[ProtocolQualifiedIdentifier, ...]
    dialect: Literal["clickhouse"] = "clickhouse"
    kind: Literal["sql-expression"] = "sql-expression"


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
    query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)


def _array(value: object, path: str, max_items: int) -> list[object]:
    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > max_items:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TOO_MANY_ITEMS", path)
    return items


def _exact_fields(value: dict[str, object], required: tuple[str, ...], path: str) -> None:
    allowed = frozenset(required)
    for key in value:
        if type(key) is not str:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNSAFE_OBJECT", path)
        if key not in allowed:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", f"{path}.{key}")


def _qualified_identifier(value: object, path: str) -> ProtocolQualifiedIdentifier:
    try:
        return parse_protocol_qualified_identifier(value)
    except ProtocolIdentifierError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER", path)


def _sql_text(value: object, path: str, max_bytes: int) -> str:
    if type(value) is not str:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", path)
    if not value.strip():
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    for character in value:
        code = ord(character)
        # Tab, newline, and carriage return are the only control characters a
        # formatted SQL fragment legitimately contains.
        if (
            (code <= 0x1F and code not in (0x09, 0x0A, 0x0D))
            or code == 0x7F
            or 0x80 <= code <= 0x9F
        ):
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", path)
    if len(value) > max_bytes or exceeds_utf8_byte_limit(value, max_bytes):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_TOO_LARGE", path)
    return value


def validate_protocol_sql_expression(
    value: object,
    *,
    limits: ProtocolQueryImplementationLimits = DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS,
) -> ProtocolSqlExpression:
    """Validate plain data as a trusted-local SQL expression and detach it."""

    record = _record(value, "$")
    _exact_fields(record, ("kind", "dialect", "sql", "output", "dependencies"), "$")
    if record["kind"] != "sql-expression":
        if type(record["kind"]) is not str:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", "$.kind")
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND", "$.kind")

    dependencies = tuple(
        _qualified_identifier(dependency, f"$.dependencies[{index}]")
        for index, dependency in enumerate(
            _array(record["dependencies"], "$.dependencies", limits.max_collection_items)
        )
    )
    if len(set(dependencies)) != len(dependencies):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.dependencies")

    try:
        output = validate_protocol_schema(record["output"])
    except ProtocolSchemaError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.output")

    if record["dialect"] != "clickhouse":
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.dialect")

    return ProtocolSqlExpression(
        sql=_sql_text(record["sql"], "$.sql", limits.max_expression_bytes),
        output=output,
        dependencies=dependencies,
    )


def sql_expression_to_data(expression: ProtocolSqlExpression) -> dict[str, object]:
    """Serialize a validated SQL expression back into detached protocol data."""

    return {
        "kind": expression.kind,
        "dialect": expression.dialect,
        "sql": expression.sql,
        "output": schema_to_data(expression.output),
        "dependencies": list(expression.dependencies),
    }
