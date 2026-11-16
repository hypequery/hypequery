"""Business context in the MCP tools, byte for byte what `@hypequery/mcp` serves."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, TypeVar, cast

import pytest

from hypequery.agent import InProcessToolsClient, ToolFailure, ToolSuccess
from hypequery.datasets import define_business_context
from hypequery.mcp import (
    ApiContractBackend,
    ApiExecutorFactory,
    ClientContractExecutor,
    HttpExecutorFactory,
    McpPrincipal,
    format_business_context,
)
from hypequery.mcp.utils.business_context import (
    LIST_DATASETS_CONTEXT_INLINE_BYTES,
    list_datasets_business_context,
    resolve_mcp_business_context,
)
from hypequery.protocol import ProtocolBusinessContextError
from mcp_support import READER, build_api

T = TypeVar("T")
SPECS = Path(__file__).resolve().parents[3] / "specs"
SNAPSHOT = cast(
    dict[str, Any], json.loads((SPECS / "mcp" / "business-context-v1.json").read_text())
)
DOCUMENTS = {
    cast(str, case["id"]): cast(dict[str, object], case["value"])
    for case in json.loads(
        (SPECS / "security-protocol/fixtures/business-context-v1/success.json").read_text()
    )
}
HEADER: dict[str, object] = {"kind": "hypequery-business-context", "version": 1}
CONTEXT = define_business_context(
    summary="B2B analytics platform sold per seat.",
    kpis=[{"name": "Net revenue", "definition": "Gross revenue minus refunds, in USD."}],
    glossary=[{"term": "Workspace", "meaning": "One paying customer account."}],
    conventions="USD, UTC, fiscal year starts in February.",
    caveats=["Orders before 2024-03 have no region."],
)
EXPECTED = {key: value for key, value in CONTEXT.items() if key not in ("kind", "version")}


def run(operation: Callable[[], Awaitable[T]]) -> T:
    return asyncio.run(operation())  # type: ignore[arg-type]


def connect(business_context: Mapping[str, object] | None = None) -> ClientContractExecutor:
    api, _ = build_api()
    return run(
        lambda: ClientContractExecutor.create(
            ApiContractBackend(api, headers=READER), business_context=business_context
        )
    )


def tools(executor: ClientContractExecutor) -> dict[str, dict[str, Any]]:
    manifest = run(executor.list_tools)
    return {tool["name"]: tool for tool in cast(list[dict[str, Any]], manifest["tools"])}


def structured(result: Mapping[str, object]) -> dict[str, Any]:
    return cast(dict[str, Any], result["structuredContent"])


def big_glossary() -> dict[str, object]:
    glossary = [{"term": f"Term {index}", "meaning": "x" * 4_000} for index in range(10)]
    return {**HEADER, "summary": "Big glossary.", "glossary": glossary}


# Parity with the TypeScript snapshot (specs/mcp/business-context-v1.json) ---


def test_the_tool_and_list_datasets_additions_match_typescript() -> None:
    advertised = tools(connect(CONTEXT))
    assert json.dumps(advertised["get_business_context"]) == json.dumps(
        SNAPSHOT["getBusinessContextTool"]
    )
    listing = advertised["list_datasets"]
    assert listing["description"] == SNAPSHOT["listDatasetsDescription"]
    success = listing["outputSchema"]["oneOf"][0]
    assert json.dumps(success["properties"]["businessContext"]) == json.dumps(
        SNAPSHOT["listDatasetsBusinessContextSchema"]
    )


@pytest.mark.parametrize("case", SNAPSHOT["documents"], ids=lambda case: cast(str, case["id"]))
def test_listing_and_markdown_match_typescript(case: dict[str, Any]) -> None:
    document = DOCUMENTS[case["id"]]
    context = resolve_mcp_business_context(document)
    assert context is not None
    assert json.dumps(list_datasets_business_context(context)) == json.dumps(case["listed"])
    assert format_business_context(document) == case["markdown"]
    # The headerless form get_business_context returns renders the same.
    assert format_business_context(context) == case["markdown"]


def test_headerless_markdown_matches_typescript() -> None:
    assert format_business_context({"conventions": "EUR."}) == SNAPSHOT["headerlessMarkdown"]


def test_the_inline_limit_counts_the_same_utf8_bytes_as_typescript() -> None:
    limit = SNAPSHOT["inlineLimit"]
    assert limit["bytes"] == LIST_DATASETS_CONTEXT_INLINE_BYTES

    def sized(summary_length: int) -> dict[str, object]:
        goals = ["é" * 2_000] * 8
        return {**HEADER, "summary": "x" * summary_length, "goals": goals}

    at_limit = resolve_mcp_business_context(sized(limit["summaryLength"]))
    over_limit = resolve_mcp_business_context(sized(limit["summaryLength"] + 1))
    assert at_limit is not None
    assert over_limit is not None
    assert list(list_datasets_business_context(at_limit)) == limit["atLimit"]
    assert json.dumps(list_datasets_business_context(over_limit)) == json.dumps(limit["overLimit"])
    big = resolve_mcp_business_context(big_glossary())
    assert big is not None
    assert json.dumps(list_datasets_business_context(big)) == json.dumps(SNAPSHOT["truncated"])


# The executor ----------------------------------------------------------------


def test_get_business_context_is_listed_last_and_only_with_context() -> None:
    without, with_context = connect(), connect(CONTEXT)
    assert list(tools(without)) == [
        "list_datasets",
        "get_dataset_schema",
        "query_metric",
        "query_dataset",
    ]
    assert list(tools(with_context)) == [*tools(without), "get_business_context"]
    # Context is guidance only: it never changes the query contract.
    assert with_context.manifest_hash == without.manifest_hash
    manifest, bare = with_context.manifest, without.manifest
    assert manifest["_meta"] == bare["_meta"]


def test_without_context_list_datasets_is_unchanged() -> None:
    advertised = tools(connect())["list_datasets"]
    assert advertised["description"] == (
        "List authorized dataset groups with their descriptions, including "
        "metric-only groups whose queryable flag is false."
    )
    assert "businessContext" not in advertised["outputSchema"]["oneOf"][0]["properties"]


def test_list_datasets_carries_the_context_and_get_business_context_returns_it() -> None:
    executor = connect(CONTEXT)
    listed = structured(run(lambda: executor.call_tool("list_datasets")))
    assert listed["businessContext"] == EXPECTED
    assert listed["total"] == 1
    assert list(listed) == ["datasets", "total", "businessContext"]

    got = run(lambda: executor.call_tool("get_business_context"))
    assert "isError" not in got
    assert structured(got) == {"businessContext": EXPECTED}
    content = cast(list[dict[str, str]], got["content"])
    assert json.loads(content[0]["text"]) == {"businessContext": EXPECTED}


def test_without_context_get_business_context_is_an_unknown_tool() -> None:
    executor = connect()
    assert "businessContext" not in structured(run(lambda: executor.call_tool("list_datasets")))
    refused = run(lambda: executor.call_tool("get_business_context"))
    assert refused["isError"] is True
    assert structured(refused)["error"]["code"] == "MCP_UNKNOWN_TOOL"


def test_an_empty_document_is_no_context() -> None:
    assert "get_business_context" not in tools(connect(HEADER))
    assert "get_business_context" not in tools(connect(define_business_context(goals=[])))


def test_an_invalid_document_is_refused_before_discovery() -> None:
    class NoBackend:
        async def discover(self, max_bytes: int) -> Any:
            raise AssertionError("not called")

        async def query(self, *args: object) -> Any:
            raise AssertionError("not called")

    duplicate = {
        **HEADER,
        "glossary": [{"term": "Seat", "meaning": "A user"}, {"term": "Seat", "meaning": "Twice"}],
    }
    with pytest.raises(ProtocolBusinessContextError) as raised:
        run(lambda: ClientContractExecutor.create(NoBackend(), business_context=duplicate))
    assert raised.value.path == "$.glossary[1].term"


def test_a_large_context_lists_only_its_summary() -> None:
    executor = connect(big_glossary())
    listed = structured(run(lambda: executor.call_tool("list_datasets")))["businessContext"]
    assert listed["summary"] == "Big glossary."
    assert listed["truncated"] is True
    assert "glossary" not in listed
    full = structured(run(lambda: executor.call_tool("get_business_context")))
    assert len(full["businessContext"]["glossary"]) == 10


def test_executor_factories_pass_the_context_on() -> None:
    api, _ = build_api()
    principal = McpPrincipal(subject="alice")
    executor = run(
        lambda: ApiExecutorFactory(api, headers=READER, business_context=CONTEXT)(principal, dict)
    )
    assert "get_business_context" in tools(executor)
    with pytest.raises(ProtocolBusinessContextError):
        ApiExecutorFactory(api, business_context={**HEADER, "summary": ""})
    with pytest.raises(ProtocolBusinessContextError):
        HttpExecutorFactory(
            "https://analytics.example.com/client-contract",
            business_context={**HEADER, "version": 2},
        )


# In-process agent tools -------------------------------------------------------


def test_in_process_agent_tools_offer_get_business_context() -> None:
    async def session() -> None:
        api, _ = build_api()
        executor = await ClientContractExecutor.create(
            ApiContractBackend(api, headers=READER), business_context=CONTEXT
        )
        client = InProcessToolsClient(executor)
        listed = await client.list_tools()
        assert [tool.name for tool in listed][-1] == "get_business_context"
        result = await client.call_tool("get_business_context", {})
        assert isinstance(result, ToolSuccess)
        assert result.data == {"businessContext": EXPECTED}

        hidden = InProcessToolsClient(executor, tools=["list_datasets"])
        refused = await hidden.call_tool("get_business_context", {})
        assert isinstance(refused, ToolFailure)
        assert refused.error.code == "MCP_UNKNOWN_TOOL"

    asyncio.run(session())


def test_the_sdk_server_validates_and_serves_the_context() -> None:
    pytest.importorskip("mcp", reason="the mcp extra is not installed")
    from mcp import Client

    from hypequery.mcp import create_mcp_server

    async def session() -> None:
        api, _ = build_api()
        executor = await ClientContractExecutor.create(
            ApiContractBackend(api, headers=READER), business_context=CONTEXT
        )
        async with Client(create_mcp_server(executor)) as client:
            names = [tool.name for tool in (await client.list_tools()).tools]
            assert names[-1] == "get_business_context"
            listed = await client.call_tool("list_datasets", {})
            assert not listed.is_error
            assert listed.structured_content is not None
            assert listed.structured_content["businessContext"] == EXPECTED
            got = await client.call_tool("get_business_context", {})
            assert not got.is_error
            assert got.structured_content == {"businessContext": EXPECTED}

    asyncio.run(session())
