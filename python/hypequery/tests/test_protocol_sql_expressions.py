"""RFC 0005 SQL expression validation.

A SQL-backed dataset field is trusted because an author wrote it during a
build, not because anything checked the SQL. These tests pin what validation
does guarantee: a bounded, structured envelope with a validated output schema
and portable dependency names.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolQueryImplementationError,
    ProtocolQueryImplementationLimits,
    ProtocolStringSchema,
    schema_to_data,
    validate_protocol_schema,
    validate_protocol_sql_expression,
)
from hypequery.protocol.schema_fixtures import normalize_schema_wire_numbers

SCHEMA_FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "query-schemas-v1"
)


def _expression(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "kind": "sql-expression",
        "dialect": "clickhouse",
        "sql": "toUpper(name)",
        "output": {"kind": "string"},
        "dependencies": ["name"],
    }
    base.update(overrides)
    return base


def test_a_valid_sql_expression_is_detached_and_typed() -> None:
    result = validate_protocol_sql_expression(_expression())

    assert result.kind == "sql-expression"
    assert result.dialect == "clickhouse"
    assert result.sql == "toUpper(name)"
    assert result.dependencies == ("name",)
    assert isinstance(result.output, ProtocolStringSchema)


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"dependencies": ["name", "name"]}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"dependencies": ["not an identifier"]}, "HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER"),
        ({"dependencies": "name"}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({"dialect": "postgres"}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"kind": "nope"}, "HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND"),
        ({"kind": 1.0}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({"sql": "   "}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"sql": ""}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"sql": 1.0}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({"output": {"kind": "nope"}}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"extra": 1.0}, "HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD"),
    ],
)
def test_invalid_sql_expressions_are_rejected_with_stable_codes(
    overrides: dict[str, object], code: str
) -> None:
    with pytest.raises(ProtocolQueryImplementationError) as raised:
        validate_protocol_sql_expression(_expression(**overrides))
    assert raised.value.code == code


def test_a_missing_field_is_a_type_failure() -> None:
    incomplete = _expression()
    del incomplete["output"]

    with pytest.raises(ProtocolQueryImplementationError) as raised:
        validate_protocol_sql_expression(incomplete)
    assert raised.value.code == "HQ_QUERY_IMPLEMENTATION_TYPE"


@pytest.mark.parametrize("control", ["\x00", "\x1f", "\x7f", "\x9f"])
def test_control_characters_are_rejected(control: str) -> None:
    with pytest.raises(ProtocolQueryImplementationError) as raised:
        validate_protocol_sql_expression(_expression(sql=f"a{control}b"))
    assert raised.value.code == "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"


@pytest.mark.parametrize("whitespace", ["\t", "\n", "\r"])
def test_formatting_whitespace_is_allowed(whitespace: str) -> None:
    """Formatted SQL legitimately spans lines; only other controls are barred."""

    result = validate_protocol_sql_expression(_expression(sql=f"a{whitespace}b"))

    assert result.sql == f"a{whitespace}b"


def test_sql_is_bounded_in_utf8_bytes() -> None:
    limits = ProtocolQueryImplementationLimits(max_expression_bytes=8)

    assert validate_protocol_sql_expression(_expression(sql="a" * 8), limits=limits)
    with pytest.raises(ProtocolQueryImplementationError) as raised:
        validate_protocol_sql_expression(_expression(sql="é" * 5), limits=limits)
    assert raised.value.code == "HQ_QUERY_IMPLEMENTATION_TOO_LARGE"

    with pytest.raises(ValueError, match="no greater than"):
        ProtocolQueryImplementationLimits(max_expression_bytes=65_537)


def test_schema_to_data_round_trips_every_shared_schema_fixture() -> None:
    """Re-emitted schemas must match the wire form the contract hashes."""

    fixtures = cast(
        list[dict[str, object]], json.loads((SCHEMA_FIXTURES / "success.json").read_text())
    )

    for fixture in fixtures:
        source = normalize_schema_wire_numbers(fixture["value"])
        emitted = schema_to_data(validate_protocol_schema(source))

        assert emitted == source, fixture["id"]
        assert schema_to_data(validate_protocol_schema(emitted)) == emitted
