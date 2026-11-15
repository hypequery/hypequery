"""hypequery.agent hands models an input schema with no top-level combinator."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import anyio
import pytest

from hypequery.agent.anthropic import hypequery_tools as anthropic_tools
from hypequery.agent.utils.model_input_schema import to_model_input_schema

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
    assert to_model_input_schema(plain) is plain


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


class _Listed:
    """A client whose query_dataset has the canonical, per-dataset schema."""

    async def list_tools(self) -> list[Any]:
        from hypequery.agent.utils.results import to_definition

        schema = FIXTURES["build"]["query_dataset"]
        return [to_definition({"name": "query_dataset", "inputSchema": schema})]

    async def call_tool(self, name: str, arguments: object = None) -> Any:
        raise AssertionError("not called")

    async def aclose(self) -> None:
        return None


def _assert_flat(schema: dict[str, Any]) -> None:
    assert [key for key in COMBINATORS if key in schema] == []


def test_the_anthropic_adapter_sends_the_flat_schema() -> None:
    async def run() -> None:
        tools = await anthropic_tools(client=_Listed())
        _assert_flat(tools.tools[0]["input_schema"])  # type: ignore[arg-type]

    anyio.run(run)


def test_the_openai_agents_adapter_sends_the_flat_schema() -> None:
    pytest.importorskip("agents", reason="openai-agents is not installed")
    from hypequery.agent.openai_agents import hypequery_tools

    async def run() -> None:
        [tool] = await hypequery_tools(client=_Listed())
        _assert_flat(tool.params_json_schema)

    anyio.run(run)


def test_the_pydantic_ai_adapter_sends_the_flat_schema() -> None:
    pytest.importorskip("pydantic_ai", reason="pydantic-ai is not installed")
    from hypequery.agent.pydantic_ai import hypequery_tools

    async def run() -> None:
        [tool] = await hypequery_tools(client=_Listed())
        _assert_flat(tool.function_schema.json_schema)

    anyio.run(run)


def test_the_langchain_adapter_sends_the_flat_schema() -> None:
    pytest.importorskip("langchain_core", reason="langchain-core is not installed")
    from langchain_core.utils.function_calling import convert_to_openai_tool

    from hypequery.agent.langchain import hypequery_tools

    async def run() -> None:
        [tool] = await hypequery_tools(client=_Listed())
        assert isinstance(tool.args_schema, dict)
        _assert_flat(tool.args_schema)
        _assert_flat(convert_to_openai_tool(tool)["function"]["parameters"])

    anyio.run(run)
