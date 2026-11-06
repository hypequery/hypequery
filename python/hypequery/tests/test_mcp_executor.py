"""The native MCP executor over an `Api` served in this process."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar, cast

import pytest

from hypequery.datasets import ClientQueryProfile
from hypequery.mcp import (
    ApiContractBackend,
    BackendResponse,
    CatalogBudget,
    ClientContractExecutor,
    ExecutionBudget,
    McpToolError,
    QueryLimits,
)
from hypequery.mcp.utils.profile import mcp_client_profile
from hypequery.protocol import build_client_contract_tool_schemas, validate_protocol_client_contract
from hypequery.serve import EndpointPolicy, add_metric_endpoint, create_api
from mcp_support import READER, Executor, build_api

T = TypeVar("T")
FIXTURES = (
    Path(__file__).resolve().parents[3] / "specs/security-protocol/fixtures/client-contract-v1"
)


def run(operation: Callable[[], Awaitable[T]]) -> T:
    return asyncio.run(operation())  # type: ignore[arg-type]


def connect(**options: object) -> tuple[ClientContractExecutor, Executor]:
    api, executor = build_api(**options)  # type: ignore[arg-type]
    return run(
        lambda: ClientContractExecutor.create(ApiContractBackend(api, headers=READER))
    ), executor


def call(
    executor: ClientContractExecutor, name: str, arguments: object = None
) -> dict[str, object]:
    return run(lambda: executor.call_tool(name, arguments))  # type: ignore[arg-type]


def error_code(result: dict[str, object]) -> str:
    assert result["isError"] is True
    structured = cast(dict[str, dict[str, str]], result["structuredContent"])
    return structured["error"]["code"]


# Parity with TypeScript --------------------------------------------------


@dataclass
class _NoBackend:
    async def discover(self, max_bytes: int) -> BackendResponse:
        raise AssertionError("not called")

    async def query(self, *args: object) -> BackendResponse:
        raise AssertionError("not called")


SUCCESS = cast(list[dict[str, object]], json.loads((FIXTURES / "success.json").read_text()))
MANIFESTS = cast(
    dict[str, dict[str, object]],
    json.loads((FIXTURES.parents[2] / "mcp/bridge-manifests-v1.json").read_text()),
)


@pytest.mark.parametrize("case", SUCCESS, ids=lambda case: cast(str, case["id"]))
def test_the_manifest_matches_the_typescript_bridge(case: dict[str, object]) -> None:
    contract = validate_protocol_client_contract(case["value"])
    executor = ClientContractExecutor(
        _NoBackend(),
        contract,
        budget=ExecutionBudget(),
        query_limits=QueryLimits(),
        catalog_budget=CatalogBudget(),
        max_contract_bytes=262_144,
    )
    manifest = executor.manifest
    tools = cast(list[dict[str, object]], manifest["tools"])
    schemas = build_client_contract_tool_schemas(mcp_client_profile(contract, QueryLimits()))
    for tool in tools:
        if tool["name"] in ("query_dataset", "query_metric"):
            expected = schemas[
                "query_dataset" if tool["name"] == "query_dataset" else "query_metric"
            ]
            assert tool["inputSchema"] == expected
            tool["inputSchema"] = "tool-schemas-v1.json"
    assert json.dumps(manifest) == json.dumps(MANIFESTS[cast(str, case["id"])])


# Tools ---------------------------------------------------------------------


def test_lists_the_four_fixed_tools_with_contract_identities() -> None:
    executor, _ = connect()
    manifest = run(executor.list_tools)
    assert [tool["name"] for tool in cast(list[dict[str, object]], manifest["tools"])] == [
        "list_datasets",
        "get_dataset_schema",
        "query_metric",
        "query_dataset",
    ]
    meta = cast(dict[str, str], manifest["_meta"])
    assert meta["com.hypequery/manifestHash"] == executor.manifest_hash
    # The backend's own authorized contract, before host limits narrowed it.
    assert len(meta["com.hypequery/clientContractHash"]) == 64


def test_discovery_tools_describe_the_authorized_groups() -> None:
    executor, _ = connect()
    listed = cast(dict[str, object], call(executor, "list_datasets")["structuredContent"])
    assert listed == {
        "datasets": [
            {
                "name": "orders",
                "description": "Customer orders.",
                "queryable": True,
                "dimensionCount": 3,
                "measureCount": 3,
                "metricCount": 1,
            }
        ],
        "total": 1,
    }
    profile = cast(
        dict[str, object],
        call(executor, "get_dataset_schema", {"dataset": "orders"})["structuredContent"],
    )
    endpoints = cast(list[dict[str, object]], profile["endpoints"])
    assert [e["id"] for e in endpoints] == ["orders", "ordersTotal"]
    # Paths and schema hashes are backend plumbing, not agent-facing.
    assert all("path" not in e and "schemaHash" not in e for e in endpoints)
    assert (
        error_code(call(executor, "get_dataset_schema", {"dataset": "secret"})) == "MCP_NOT_FOUND"
    )


def test_queries_run_through_the_api_as_its_principal() -> None:
    executor, backend = connect()
    result = call(
        executor,
        "query_dataset",
        {
            "dataset": "orders",
            "dimensions": ["country"],
            "measures": ["total"],
            "limit": 2,
            "includeMeta": True,
        },
    )
    structured = cast(dict[str, object], result["structuredContent"])
    assert structured["data"] == [{"country": "US", "total": "10"}] * 2
    meta = cast(dict[str, object], structured["meta"])
    assert meta["pagination"] == {"limit": 2, "offset": 0, "hasMore": True}
    # The tenant comes from the authenticated principal, never from the agent.
    compiled = backend.seen[-1]
    assert "`tenant_id` = {p0:String}" in compiled.sql
    assert [p.value for p in compiled.parameters.values()] == ["acme"]

    metric = call(executor, "query_metric", {"dataset": "orders", "metric": "ordersTotal"})
    assert (
        cast(dict[str, object], metric["structuredContent"])["data"] == [{"ordersTotal": "10"}] * 3
    )


@pytest.mark.parametrize(
    ("name", "arguments", "code", "message"),
    [
        (
            "query_dataset",
            {"dataset": "orders", "tenant": "other"},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client tool arguments.",
        ),
        (
            "query_dataset",
            {"dataset": "secret"},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client query target.",
        ),
        (
            "query_metric",
            {"dataset": "orders", "metric": "total"},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client query target.",
        ),
        (
            "query_dataset",
            {"dataset": "orders", "dimensions": ["amount"]},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client query at /dimensions/0.",
        ),
        (
            "query_dataset",
            {"dataset": "orders", "limit": 1001},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client query at /limit.",
        ),
        (
            "list_datasets",
            {"unexpected": True},
            "MCP_INVALID_ARGUMENTS",
            "Invalid client tool arguments.",
        ),
        ("drop_table", {}, "MCP_UNKNOWN_TOOL", "Unknown client tool."),
    ],
)
def test_invalid_calls_are_correctable_tool_errors(
    name: str, arguments: dict[str, object], code: str, message: str
) -> None:
    executor, backend = connect()
    result = call(executor, name, arguments)
    assert error_code(result) == code
    error = cast(dict[str, dict[str, object]], result["structuredContent"])["error"]
    assert error["message"] == message
    assert error["correctable"] is True
    assert result["content"] == [{"type": "text", "text": f"Error [{code}]: {message}"}]
    assert backend.seen == []


def test_an_unknown_credential_cannot_connect() -> None:
    api, _ = build_api()
    backend = ApiContractBackend(api, headers={"Authorization": "Bearer stranger"})
    with pytest.raises(McpToolError) as raised:
        run(lambda: ClientContractExecutor.create(backend))
    assert raised.value.code == "MCP_UNAUTHORIZED"


def test_a_changed_contract_latches_the_session_stale() -> None:
    api, executor_backend = build_api()
    executor = run(lambda: ClientContractExecutor.create(ApiContractBackend(api, headers=READER)))
    from hypequery.datasets import create_dataset_client
    from mcp_support import orders

    add_metric_endpoint(
        api,
        "/orders-revenue",
        dataset=orders(),
        client=create_dataset_client(executor=executor_backend),
        measure="revenue",
        name="ordersRevenue",
        policy=EndpointPolicy(tenant="required", required_scopes=frozenset({"read"})),
        client_profile=ClientQueryProfile(),
    )
    result = call(executor, "list_datasets")
    assert error_code(result) == "MCP_STALE_CONTRACT"
    error = cast(dict[str, dict[str, object]], result["structuredContent"])["error"]
    assert error["retryable"] is False
    # Latched: even a call that needs no backend reports the stale session.
    assert (
        error_code(call(executor, "query_dataset", {"dataset": "orders"})) == "MCP_STALE_CONTRACT"
    )


def test_results_over_budget_become_the_smallest_error() -> None:
    api, _ = build_api()
    budget = ExecutionBudget(max_response_bytes=300)
    executor = run(
        lambda: ClientContractExecutor.create(
            ApiContractBackend(api, headers=READER), budget=budget
        )
    )
    result = call(executor, "get_dataset_schema", {"dataset": "orders"})
    assert error_code(result) == "MCP_RESULT_TOO_LARGE"


def test_a_slow_backend_times_out() -> None:
    api, _ = build_api()

    @dataclass
    class Slow:
        inner: ApiContractBackend
        delay: float = 0.0

        async def discover(self, max_bytes: int) -> BackendResponse:
            await asyncio.sleep(self.delay)
            return await self.inner.discover(max_bytes)

        async def query(self, *args: object) -> BackendResponse:
            return await self.inner.query(*args)  # type: ignore[arg-type]

    slow = Slow(ApiContractBackend(api, headers=READER))
    executor = run(lambda: ClientContractExecutor.create(slow, budget=ExecutionBudget(0.05)))
    slow.delay = 1.0
    result = call(executor, "list_datasets")
    assert error_code(result) == "MCP_QUERY_TIMEOUT"
    assert cast(dict[str, dict[str, object]], result["structuredContent"])["error"]["retryable"]


def test_host_query_limits_narrow_every_endpoint() -> None:
    api, _ = build_api()
    executor = run(
        lambda: ClientContractExecutor.create(
            ApiContractBackend(api, headers=READER), query_limits=QueryLimits(max_result_size=5)
        )
    )
    assert all(e["limits"]["maxLimit"] == 5 for e in executor.contract["endpoints"])
    assert error_code(call(executor, "query_dataset", {"dataset": "orders", "limit": 6})) == (
        "MCP_INVALID_ARGUMENTS"
    )


def test_the_guide_prompt_lists_authorized_profiles() -> None:
    executor, _ = connect()
    listed = run(executor.list_prompts)
    assert listed["prompts"] == [
        {
            "name": "dataset_guide",
            "description": "Guide to the authorized client endpoint profiles",
            "arguments": [{"name": "dataset", "required": False}],
        }
    ]
    guide = run(lambda: executor.get_prompt("dataset_guide", {"dataset": "orders"}))
    text = cast(list[dict[str, dict[str, str]]], guide["messages"])[0]["content"]["text"]
    assert text.startswith("Use only the authorized endpoints and tool schemas.")
    assert '"name":"orders"' in text
    with pytest.raises(McpToolError):
        run(lambda: executor.get_prompt("dataset_guide", {"dataset": "secret"}))


# The in-process backend ------------------------------------------------------


def test_a_mounted_api_routes_contract_paths_below_its_prefix() -> None:
    executor, backend = connect(mount="/api/agents")
    assert executor.contract["endpoints"][0]["path"] == "/api/agents/orders"
    result = call(executor, "query_dataset", {"dataset": "orders", "measures": ["total"]})
    assert "isError" not in result
    assert len(backend.seen) == 1


def test_an_api_without_discovery_is_refused_and_left_unchanged() -> None:
    api, _ = build_api(discovery=False)
    routes = api.routes
    with pytest.raises(ValueError, match="add_client_contract_endpoint"):
        ApiContractBackend(api, headers=READER)
    assert api.routes == routes


def test_an_authenticated_discovery_route_is_preferred_to_a_public_one() -> None:
    from hypequery.serve import EndpointPolicy, add_client_contract_endpoint

    api, _ = build_api(discovery=False)
    add_client_contract_endpoint(api, "/public-contract", policy=EndpointPolicy(public=True))
    add_client_contract_endpoint(api)
    executor = run(lambda: ClientContractExecutor.create(ApiContractBackend(api, headers=READER)))
    assert [e["id"] for e in executor.contract["endpoints"]] == ["orders", "ordersTotal"]


def test_only_a_served_api_is_accepted() -> None:
    with pytest.raises(TypeError):
        ApiContractBackend(cast(object, create_api), headers=READER)  # type: ignore[arg-type]


def test_host_error_details_reach_the_envelope() -> None:
    from hypequery.mcp.errors import McpToolError, classify_mcp_tool_error

    limited = McpToolError(
        "MCP_RATE_LIMITED", "Slow down.", retry_after_seconds=2.5, relist=False, reason="QUOTA"
    )
    assert classify_mcp_tool_error(limited) == {
        "code": "MCP_RATE_LIMITED",
        "category": "budget",
        "message": "Slow down.",
        "retryable": True,
        "correctable": False,
        "retryAfterSeconds": 2.5,
        "relist": False,
        "reason": "QUOTA",
    }
    # Unset details stay out of the envelope, as in TypeScript.
    assert "relist" not in classify_mcp_tool_error(McpToolError("MCP_NOT_FOUND", "No."))
    for bad in (-1, float("inf"), float("nan")):
        with pytest.raises(ValueError, match="retry_after_seconds"):
            McpToolError("MCP_RATE_LIMITED", "x", retry_after_seconds=bad)
