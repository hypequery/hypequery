"""PYB-04: RFC 0004 portable query schema validation.

The shared corpus pins cross-language agreement; the unit cases below pin the
rules the corpus only samples — default/schema agreement, bound ordering, and
the immutability of what validation hands back.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    UNSET,
    ProtocolArraySchema,
    ProtocolNullSchema,
    ProtocolNumberSchema,
    ProtocolObjectSchema,
    ProtocolSchema,
    ProtocolSchemaError,
    ProtocolSchemaLimits,
    ProtocolStringSchema,
    ProtocolUnionSchema,
    array_value,
    map_value,
    validate_protocol_schema,
)
from hypequery.protocol.schema_fixtures import (
    materialize_schema_fixture,
    normalize_schema_wire_numbers,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "query-schemas-v1"
)


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


def _validate(value: object) -> ProtocolSchema:
    return validate_protocol_schema(normalize_schema_wire_numbers(value))


@pytest.mark.parametrize("fixture", _fixtures("success.json"), ids=lambda item: str(item["id"]))
def test_shared_success_fixtures(fixture: dict[str, object]) -> None:
    schema = _validate(fixture["value"])

    assert dataclasses.is_dataclass(schema)
    assert schema.kind == cast(dict[str, object], fixture["value"])["kind"]


@pytest.mark.parametrize("fixture", _fixtures("rejections.json"), ids=lambda item: str(item["id"]))
def test_shared_rejection_fixtures(fixture: dict[str, object]) -> None:
    generator = fixture.get("generator")
    value = (
        materialize_schema_fixture(cast(dict[str, object], generator))
        if isinstance(generator, dict)
        else fixture.get("value")
    )

    with pytest.raises(ProtocolSchemaError) as raised:
        _validate(value)
    assert raised.value.code == fixture["error"]


def test_validation_returns_a_detached_immutable_snapshot() -> None:
    source: dict[str, object] = {
        "kind": "object",
        "properties": {"limit": {"kind": "integer", "minimum": 1.0}},
        "required": ["limit"],
        "unknownProperties": "reject",
    }
    schema = validate_protocol_schema(source)
    assert isinstance(schema, ProtocolObjectSchema)

    cast(dict[str, object], source["properties"])["injected"] = {"kind": "any"}
    source["required"] = ["nope"]

    assert schema.required == ("limit",)
    assert [name for name, _ in schema.properties] == ["limit"]
    with pytest.raises(dataclasses.FrozenInstanceError):
        schema.required = ()  # type: ignore[misc]


def test_absent_default_is_distinct_from_a_null_default() -> None:
    absent = validate_protocol_schema({"kind": "null"})
    explicit = validate_protocol_schema({"kind": "null", "default": None})

    assert isinstance(absent, ProtocolNullSchema)
    assert isinstance(explicit, ProtocolNullSchema)
    assert absent.default is UNSET
    assert explicit.default is None


@pytest.mark.parametrize(
    ("schema", "code"),
    [
        ({"kind": "integer", "default": 1.5}, "HQ_SCHEMA_INVALID_VALUE"),
        ({"kind": "string", "minLength": 2.0, "default": "a"}, "HQ_SCHEMA_INVALID_VALUE"),
        ({"kind": "boolean", "default": "yes"}, "HQ_SCHEMA_INVALID_VALUE"),
        ({"kind": "void", "default": None}, "HQ_SCHEMA_UNKNOWN_FIELD"),
        ({"kind": "literal", "value": 1.0, "default": 2.0}, "HQ_SCHEMA_INVALID_VALUE"),
        ({"kind": "enum", "values": ["a"], "default": "b"}, "HQ_SCHEMA_INVALID_VALUE"),
        ({"kind": "enum", "values": []}, "HQ_SCHEMA_INVALID_CONSTRAINT"),
        ({"kind": "union", "variants": [{"kind": "string"}]}, "HQ_SCHEMA_INVALID_CONSTRAINT"),
        (
            {"kind": "number", "minimum": 1.0, "exclusiveMinimum": 2.0},
            "HQ_SCHEMA_INVALID_CONSTRAINT",
        ),
        (
            {"kind": "number", "exclusiveMinimum": 1.0, "maximum": 1.0},
            "HQ_SCHEMA_INVALID_CONSTRAINT",
        ),
        ({"kind": "string", "minLength": 3.0, "maxLength": 1.0}, "HQ_SCHEMA_INVALID_CONSTRAINT"),
        ({"kind": "integer", "minimum": 1.5}, "HQ_SCHEMA_INVALID_CONSTRAINT"),
        (
            {"kind": "array", "items": {"kind": "any"}, "minItems": -1.0},
            "HQ_SCHEMA_INVALID_CONSTRAINT",
        ),
        (
            {
                "kind": "object",
                "properties": {"a": {"kind": "any"}},
                "required": ["a", "a"],
                "unknownProperties": "reject",
            },
            "HQ_SCHEMA_INVALID_REQUIRED",
        ),
        (
            {
                "kind": "object",
                "properties": {},
                "required": [],
                "unknownProperties": "allow",
            },
            "HQ_SCHEMA_INVALID_CONSTRAINT",
        ),
        (
            {
                "kind": "object",
                "properties": {"__hypequeryInternal": {"kind": "any"}},
                "required": [],
                "unknownProperties": "reject",
            },
            "HQ_SCHEMA_INVALID_IDENTIFIER",
        ),
        ({"kind": "string", "description": 1.0}, "HQ_SCHEMA_TYPE"),
        ({"kind": "literal"}, "HQ_SCHEMA_TYPE"),
    ],
)
def test_invalid_schemas_are_rejected_with_stable_codes(
    schema: dict[str, object], code: str
) -> None:
    with pytest.raises(ProtocolSchemaError) as raised:
        validate_protocol_schema(schema)
    assert raised.value.code == code


def test_defaults_are_checked_against_their_own_schema() -> None:
    schema = validate_protocol_schema(
        {
            "kind": "array",
            "items": {"kind": "string"},
            "minItems": 1.0,
            "default": array_value(["a", "b"]),
        }
    )
    assert isinstance(schema, ProtocolArraySchema)
    assert schema.min_items == 1

    # An item the element schema rejects.
    with pytest.raises(ProtocolSchemaError) as raised:
        validate_protocol_schema(
            {"kind": "array", "items": {"kind": "string"}, "default": array_value(["a", 1.0])}
        )
    assert raised.value.code == "HQ_SCHEMA_INVALID_VALUE"

    # A raw list is a raw composite, never a canonical array value.
    with pytest.raises(ProtocolSchemaError) as raised:
        validate_protocol_schema(
            {"kind": "array", "items": {"kind": "string"}, "default": ["a", "b"]}
        )
    assert raised.value.code == "HQ_SCHEMA_INVALID_VALUE"


def test_object_default_honours_the_unknown_property_policy() -> None:
    extra = map_value([("extra", "x")])
    strict: dict[str, object] = {
        "kind": "object",
        "properties": {},
        "required": [],
        "unknownProperties": "reject",
        "default": extra,
    }
    with pytest.raises(ProtocolSchemaError):
        validate_protocol_schema(strict)

    permissive = validate_protocol_schema({**strict, "unknownProperties": "preserve"})
    assert isinstance(permissive, ProtocolObjectSchema)
    assert permissive.default is not UNSET


def test_union_default_matches_any_variant() -> None:
    schema = validate_protocol_schema(
        {"kind": "union", "variants": [{"kind": "string"}, {"kind": "null"}], "default": None}
    )
    assert isinstance(schema, ProtocolUnionSchema)
    assert schema.default is None


def test_a_cyclic_schema_is_rejected_without_recursing() -> None:
    cyclic: dict[str, object] = {"kind": "array"}
    cyclic["items"] = cyclic

    with pytest.raises(ProtocolSchemaError) as raised:
        validate_protocol_schema(cyclic)
    assert raised.value.code == "HQ_SCHEMA_UNSAFE_OBJECT"


def test_description_is_bounded_in_utf8_bytes_not_characters() -> None:
    limits = ProtocolSchemaLimits(max_description_bytes=8)

    assert validate_protocol_schema({"kind": "any", "description": "a" * 8}, limits=limits)
    with pytest.raises(ProtocolSchemaError) as raised:
        # Four characters, eight bytes is fine; five characters is ten bytes.
        validate_protocol_schema({"kind": "any", "description": "é" * 5}, limits=limits)
    assert raised.value.code == "HQ_SCHEMA_TOO_LARGE"


def test_limits_may_be_lowered_but_not_raised() -> None:
    lowered = ProtocolSchemaLimits(max_depth=2)

    assert validate_protocol_schema({"kind": "array", "items": {"kind": "any"}}, limits=lowered)
    with pytest.raises(ProtocolSchemaError) as raised:
        validate_protocol_schema(
            {"kind": "array", "items": {"kind": "array", "items": {"kind": "any"}}},
            limits=lowered,
        )
    assert raised.value.code == "HQ_SCHEMA_TOO_DEEP"

    with pytest.raises(ValueError, match="no greater than"):
        ProtocolSchemaLimits(max_depth=17)
    with pytest.raises(ValueError, match="no greater than"):
        ProtocolSchemaLimits(max_nodes=0)


def test_number_bounds_are_preserved_as_binary64() -> None:
    schema = validate_protocol_schema(
        {"kind": "number", "exclusiveMinimum": 0.0, "maximum": 100.5, "default": 10.5}
    )
    assert isinstance(schema, ProtocolNumberSchema)
    assert schema.exclusive_minimum == 0.0
    assert schema.maximum == 100.5
    assert schema.minimum is None


def test_string_bounds_count_code_points() -> None:
    schema = validate_protocol_schema({"kind": "string", "maxLength": 2.0, "default": "é" * 2})
    assert isinstance(schema, ProtocolStringSchema)
    assert schema.max_length == 2
