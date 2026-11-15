"""hypequery.mcp advertises query input schemas with no top-level combinator."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from hypequery.mcp.utils.model_input_schema import accepts_no_input, to_model_input_schema

# The canonical query_dataset schemas both languages build, pinned cross-language.
FIXTURES: dict[str, dict[str, Any]] = json.loads(
    (Path(__file__).parents[3] / "specs/mcp/tool-schemas-v1.json").read_text("utf-8")
)
COMBINATORS = ("anyOf", "oneOf", "allOf")


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_every_fixture_becomes_a_provider_ready_object_schema(name: str) -> None:
    for tool in ("query_dataset", "query_metric"):
        schema = FIXTURES[name].get(tool)
        if schema is None:
            continue
        model = to_model_input_schema(schema)
        assert model["type"] == "object"
        assert [key for key in COMBINATORS if key in model] == []


def test_every_dataset_and_its_fields_are_still_offered() -> None:
    schema = FIXTURES["build"]["query_dataset"]
    model: Any = to_model_input_schema(schema)
    datasets = [variant["properties"]["dataset"] for variant in schema["anyOf"]]
    offered = model["properties"]["dataset"]
    assert all(dataset in offered.get("anyOf", [offered]) for dataset in datasets)
    assert "dataset" in model["required"]
    assert model["additionalProperties"] is False


def test_a_schema_without_combinators_is_returned_as_is() -> None:
    plain: dict[str, object] = {"type": "object", "properties": {"a": {"type": "string"}}}
    assert to_model_input_schema(plain) == plain


def test_object_members_of_all_of_merge_and_constraints_are_dropped() -> None:
    model = to_model_input_schema(
        {
            "type": "object",
            "properties": {"dataset": {"const": "orders"}},
            "required": ["dataset"],
            "allOf": [
                {"properties": {"limit": {"type": "integer"}}, "required": ["limit"]},
                {"anyOf": [{"required": ["dimensions"]}, {"required": ["measures"]}]},
                {"properties": {"dataset": {"type": "string"}}},
            ],
        }
    )
    assert model == {
        "type": "object",
        "properties": {
            "dataset": {"allOf": [{"const": "orders"}, {"type": "string"}]},
            "limit": {"type": "integer"},
        },
        "required": ["dataset", "limit"],
    }


def test_any_of_and_one_of_both_bind_when_both_are_present() -> None:
    model = to_model_input_schema(
        {
            "type": "object",
            "anyOf": [
                {"properties": {"a": {"type": "string"}}, "required": ["a"]},
                {"properties": {"a": {"type": "number"}}, "required": ["a"]},
            ],
            "oneOf": [{"properties": {"b": {"type": "string"}}, "required": ["b"]}],
        }
    )
    assert model == {
        "type": "object",
        "properties": {
            "a": {"anyOf": [{"type": "string"}, {"type": "number"}]},
            "b": {"type": "string"},
        },
        "required": ["a", "b"],
    }


def test_definitions_a_ref_points_at_are_kept() -> None:
    model = to_model_input_schema(
        {
            "type": "object",
            "anyOf": [
                {
                    "properties": {"filter": {"$ref": "#/$defs/Filter"}},
                    "$defs": {"Filter": {"type": "object"}},
                },
                {"properties": {"limit": {"type": "integer"}}},
            ],
        }
    )
    assert model["$defs"] == {"Filter": {"type": "object"}}


def test_a_tool_with_nothing_offered_accepts_no_input() -> None:
    assert accepts_no_input(FIXTURES["empty"]["query_dataset"])
    assert accepts_no_input(FIXTURES["empty"]["query_metric"])
    assert accepts_no_input(FIXTURES["metric-only"]["query_dataset"])
    assert not accepts_no_input(FIXTURES["metric-only"]["query_metric"])
    assert not accepts_no_input(FIXTURES["build"]["query_dataset"])


def test_only_a_required_unsatisfiable_property_counts() -> None:
    assert not accepts_no_input({"type": "object", "properties": {"dataset": {"not": {}}}})
    assert not accepts_no_input(
        {"type": "object", "properties": {"a": {"not": {"type": "string"}}}, "required": ["a"]}
    )
    assert accepts_no_input({"type": "object", "properties": {"a": {"not": {}}}, "required": ["a"]})


def test_a_draft_07_tuple_is_rewritten_in_draft_2020_12_terms() -> None:
    pair = [{"type": "string"}, {"type": "string"}]
    between: dict[str, object] = {"type": "array", "items": pair}
    schema: dict[str, object] = {
        "type": "object",
        "properties": {"value": {**between, "additionalItems": False}, "range": between},
        "enum_like": {"enum": [{"items": [1, 2]}]},
    }
    model = to_model_input_schema(schema)
    properties = model["properties"]
    assert isinstance(properties, dict)
    assert properties["value"] == {
        "type": "array",
        "prefixItems": [{"type": "string"}, {"type": "string"}],
        "items": False,
    }
    assert properties["range"] == {
        "type": "array",
        "prefixItems": [{"type": "string"}, {"type": "string"}],
    }
    # Data keywords hold values, not schemas, and stay as they are.
    assert model["enum_like"] == {"enum": [{"items": [1, 2]}]}


def test_the_advertised_manifests_are_valid_draft_2020_12() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    manifests: dict[str, Any] = json.loads(
        (Path(__file__).parents[3] / "specs/mcp/bridge-manifests-v1.json").read_text("utf-8")
    )
    for manifest in manifests.values():
        for tool in manifest["tools"]:
            jsonschema.Draft202012Validator.check_schema(tool["inputSchema"])
            assert [key for key in COMBINATORS if key in tool["inputSchema"]] == []
