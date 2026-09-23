"""RFC 0005 SQL expression validation.

A SQL-backed dataset field and a named-query implementation carry the same
shape: trusted-local SQL text, the schema of what it produces, and the logical
identifiers it reads. It is trusted because an author wrote it during a build,
never because it was checked — this validator bounds and structures it, it does
not parse or sanitize SQL. Anything portable goes through the expression AST
instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .errors import ProtocolSchemaError, query_implementation_error
from .identifiers import ProtocolQualifiedIdentifier
from .query_implementation_primitives import (
    DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS,
    ProtocolQueryImplementationLimits,
    array,
    bounded_text,
    exact_fields,
    qualified_identifier,
    record,
)
from .schema_models import ProtocolSchema, schema_to_data
from .schemas import validate_protocol_schema


@dataclass(frozen=True, slots=True)
class ProtocolSqlExpression:
    """Trusted-local SQL, the schema it produces, and the fields it reads."""

    sql: str
    output: ProtocolSchema
    dependencies: tuple[ProtocolQualifiedIdentifier, ...]
    dialect: Literal["clickhouse"] = "clickhouse"
    kind: Literal["sql-expression"] = "sql-expression"


def validate_protocol_sql_expression(
    value: object,
    *,
    limits: ProtocolQueryImplementationLimits = DEFAULT_PROTOCOL_QUERY_IMPLEMENTATION_LIMITS,
) -> ProtocolSqlExpression:
    """Validate plain data as a trusted-local SQL expression and detach it."""

    field = record(value, "$")
    exact_fields(field, ("kind", "dialect", "sql", "output", "dependencies"), "$")
    if field["kind"] != "sql-expression":
        if type(field["kind"]) is not str:
            query_implementation_error("HQ_QUERY_IMPLEMENTATION_TYPE", "$.kind")
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND", "$.kind")

    dependencies = tuple(
        qualified_identifier(dependency, f"$.dependencies[{index}]")
        for index, dependency in enumerate(
            array(field["dependencies"], "$.dependencies", limits.max_collection_items)
        )
    )
    if len(set(dependencies)) != len(dependencies):
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.dependencies")

    try:
        output = validate_protocol_schema(field["output"])
    except ProtocolSchemaError:
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.output")

    if field["dialect"] != "clickhouse":
        query_implementation_error("HQ_QUERY_IMPLEMENTATION_INVALID_VALUE", "$.dialect")

    return ProtocolSqlExpression(
        sql=bounded_text(
            field["sql"], "$.sql", limits.max_expression_bytes, allow_sql_whitespace=True
        ),
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
