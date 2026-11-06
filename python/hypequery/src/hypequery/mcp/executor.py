"""Serve the four MCP tools from an authorized client contract.

Ports `@hypequery/mcp`'s `HypequeryMCPHttpExecutor`. The backend owns SQL,
authentication and tenant scope; the executor advertises the contract's
schemas, validates every call with the shared client-query validator, posts
the plan, and checks the result against it. It pins the contract it started
with: a changed contract or a `409` latches `MCP_STALE_CONTRACT` until the
agent reconnects.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping

from ..protocol import (
    ClientContractToolSchemas,
    ClientQueryPlan,
    ProtocolClientContract,
    ProtocolClientContractError,
    build_client_contract_tool_schemas,
    decode_protocol_client_contract,
    validate_protocol_client_query,
)
from .backends.base import BackendResponse, ContractBackend
from .budgets import (
    CatalogBudget,
    ExecutionBudget,
    QueryLimits,
    assert_manifest_within_budget,
    assert_within_budget,
    within_budget,
)
from .errors import McpToolError, result_too_large, stale_contract
from .manifest import client_tool_manifest
from .responses import (
    ToolResult,
    compact_json,
    error_response,
    result_too_large_response,
    tool_response,
)
from .utils.arguments import tool_arguments
from .utils.discovery import client_dataset_list, client_dataset_names, client_dataset_profile
from .utils.profile import mcp_client_profile
from .utils.results import client_http_result

DEFAULT_MAX_CONTRACT_BYTES = 262_144
MAX_CONTRACT_BYTES = 1_048_576
#: A bridged result is never larger than this, whatever the execution budget.
MAX_BRIDGE_RESPONSE_BYTES = 1_048_576

QUERY_ARGUMENTS = (
    "dataset",
    "metric",
    "dimensions",
    "measures",
    "filters",
    "having",
    "grain",
    "timezone",
    "orderBy",
    "limit",
    "offset",
    "includeMeta",
)

GUIDE_TEXT = (
    "Use only the authorized endpoints and tool schemas. A metric-only dataset group is "
    "not a query_dataset target. Each endpoint retains its own fields, defaults and "
    "limits. For pagination, request includeMeta=true when metadata is available and "
    "follow pagination.hasMore and offset + limit. Tenant and credentials belong to the "
    "backend host. Reconnect explicitly after a stale-contract error.\n"
)


def _require_success(response: BackendResponse) -> None:
    if response.status == 200:
        return
    if response.status in (401, 403):
        raise McpToolError("MCP_UNAUTHORIZED", "Backend access denied.")
    if response.status == 409:
        raise stale_contract()
    raise McpToolError(
        "MCP_EXECUTION_FAILED",
        "Backend request was refused.",
        retryable=response.status == 429 or response.status >= 500,
    )


def _json_text(response: BackendResponse) -> str:
    media = (response.content_type or "").split(";", 1)[0].strip().lower()
    if media != "application/json" and not (
        media.startswith("application/") and media.endswith("+json")
    ):
        raise McpToolError("MCP_EXECUTION_FAILED", "Backend did not return JSON.", retryable=False)
    if response.oversized:
        raise result_too_large("Backend response exceeds its byte limit.")
    try:
        # Like TextDecoder: one leading byte-order mark is not part of the JSON.
        return response.body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise McpToolError(
            "MCP_EXECUTION_FAILED", "Backend response could not be read.", retryable=False
        ) from None


def _decode_contract(text: str) -> ProtocolClientContract:
    try:
        contract = decode_protocol_client_contract(text)
    except ProtocolClientContractError:
        contract = None
    if contract is None or contract["view"] != "authorized":
        raise McpToolError(
            "MCP_EXECUTION_FAILED",
            "Backend returned an invalid authorized client contract.",
            retryable=False,
        )
    return contract


class ClientContractExecutor:
    """The MCP tools for one principal's authorized client contract."""

    def __init__(
        self,
        backend: ContractBackend,
        contract: ProtocolClientContract,
        *,
        budget: ExecutionBudget,
        query_limits: QueryLimits,
        catalog_budget: CatalogBudget,
        max_contract_bytes: int,
    ) -> None:
        self._backend = backend
        self._authorized_hash = contract["contentHash"]
        self._budget = budget
        self._contract_bytes = max_contract_bytes
        self._schemas: ClientContractToolSchemas = build_client_contract_tool_schemas(
            mcp_client_profile(contract, query_limits)
        )
        self._manifest = assert_manifest_within_budget(
            client_tool_manifest(self._schemas, self._authorized_hash), catalog_budget
        )
        self._invalidated = False

    @classmethod
    async def create(
        cls,
        backend: ContractBackend,
        *,
        budget: ExecutionBudget | None = None,
        query_limits: QueryLimits | None = None,
        catalog_budget: CatalogBudget | None = None,
        max_contract_bytes: int = DEFAULT_MAX_CONTRACT_BYTES,
    ) -> ClientContractExecutor:
        """Discover the authorized contract once and pin it for the session."""

        if type(max_contract_bytes) is not int or not 1 <= max_contract_bytes <= MAX_CONTRACT_BYTES:
            raise ValueError(
                f"max_contract_bytes must be an integer between 1 and {MAX_CONTRACT_BYTES}"
            )
        configured = budget or ExecutionBudget()
        effective = ExecutionBudget(
            configured.timeout_seconds,
            min(configured.max_response_bytes, MAX_BRIDGE_RESPONSE_BYTES),
        )

        async def discover() -> ProtocolClientContract:
            response = await backend.discover(max_contract_bytes)
            _require_success(response)
            return _decode_contract(_json_text(response))

        contract = await within_budget(discover, effective)
        return cls(
            backend,
            contract,
            budget=effective,
            query_limits=query_limits or QueryLimits(),
            catalog_budget=catalog_budget or CatalogBudget(),
            max_contract_bytes=max_contract_bytes,
        )

    @property
    def manifest_hash(self) -> str:
        return self._schemas["manifest_hash"]

    @property
    def manifest(self) -> dict[str, object]:
        """The pinned `tools/list` result, without re-reading the contract."""

        return copy.deepcopy(self._manifest)

    @property
    def contract(self) -> ProtocolClientContract:
        """The MCP profile of the pinned contract: its limits narrowed to the host's."""

        return self._schemas["contract"]

    def _assert_active(self) -> None:
        if self._invalidated:
            raise stale_contract()

    def _checked(self, response: BackendResponse) -> None:
        try:
            _require_success(response)
        except McpToolError:
            if response.status == 409:
                self._invalidated = True
            raise

    async def _current(self) -> None:
        """Re-read the contract; any change latches the session stale."""

        self._assert_active()
        response = await self._backend.discover(self._contract_bytes)
        self._checked(response)
        if _decode_contract(_json_text(response))["contentHash"] != self._authorized_hash:
            self._invalidated = True
        self._assert_active()

    async def list_tools(self) -> dict[str, object]:
        await within_budget(self._current, self._budget)
        return copy.deepcopy(self._manifest)

    def _plan(self, name: str, arguments: Mapping[str, object] | None) -> ClientQueryPlan:
        query = tool_arguments(arguments, QUERY_ARGUMENTS)
        endpoint = next(
            (
                e
                for e in self.contract["endpoints"]
                if (
                    e["kind"] == "dataset" and e["id"] == query.get("dataset")
                    if name == "query_dataset"
                    else e["kind"] == "metric"
                    and e["dataset"] == query.get("dataset")
                    and e["id"] == query.get("metric")
                )
            ),
            None,
        )
        if endpoint is None:
            raise McpToolError("MCP_INVALID_ARGUMENTS", "Invalid client query target.")
        try:
            return validate_protocol_client_query(self.contract, endpoint["id"], query, "mcp")
        except ProtocolClientContractError as error:
            # The pointer names a contract member or an index, never a submitted value.
            path = error.path
            message = f"Invalid client query at {path}." if path else "Invalid client query."
            raise McpToolError("MCP_INVALID_ARGUMENTS", message) from None

    def _dataset_argument(self, arguments: Mapping[str, object] | None) -> str:
        dataset = tool_arguments(arguments, ("dataset",)).get("dataset")
        if type(dataset) is not str or dataset not in client_dataset_names(self.contract):
            raise McpToolError("MCP_NOT_FOUND", "Dataset group not found.")
        return dataset

    async def _execute(self, plan: ClientQueryPlan | None, dataset: str | None) -> ToolResult:
        await self._current()
        value: dict[str, object]
        if plan is not None:
            endpoint = plan["endpoint"]
            response = await self._backend.query(
                endpoint["path"],
                plan["body"],
                endpoint["schemaHash"],
                self._budget.max_response_bytes,
            )
            self._checked(response)
            value = client_http_result(_json_text(response), plan)
        elif dataset is None:
            value = client_dataset_list(self.contract)
        else:
            value = client_dataset_profile(self.contract, dataset)
        result = tool_response(value)
        assert_within_budget(result, self._budget)
        return result

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> ToolResult:
        """Run one tool; every failure is a tool result, never an exception."""

        try:
            self._assert_active()
            plan: ClientQueryPlan | None = None
            dataset: str | None = None
            if name in ("query_dataset", "query_metric"):
                plan = self._plan(name, arguments)
            elif name == "list_datasets":
                tool_arguments(arguments, ())
            elif name == "get_dataset_schema":
                dataset = self._dataset_argument(arguments)
            else:
                raise McpToolError("MCP_UNKNOWN_TOOL", "Unknown client tool.")
            return await within_budget(lambda: self._execute(plan, dataset), self._budget)
        except Exception as error:
            result = error_response(error)
            try:
                assert_within_budget(result, self._budget)
            except McpToolError:
                return result_too_large_response()
            return result

    async def list_prompts(self) -> dict[str, object]:
        await within_budget(self._current, self._budget)
        return {
            "prompts": [
                {
                    "name": "dataset_guide",
                    "description": "Guide to the authorized client endpoint profiles",
                    "arguments": [{"name": "dataset", "required": False}],
                }
            ]
        }

    async def get_prompt(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> dict[str, object]:
        """`dataset_guide`: usage rules plus the authorized profiles. Raises `McpToolError`."""

        dataset = tool_arguments(arguments, ("dataset",)).get("dataset")
        if name != "dataset_guide" or (
            dataset is not None
            and (type(dataset) is not str or dataset not in client_dataset_names(self.contract))
        ):
            raise McpToolError("MCP_NOT_FOUND", "Client guide not found.")
        await within_budget(self._current, self._budget)
        profiles = (
            client_dataset_list(self.contract)
            if dataset is None
            else client_dataset_profile(self.contract, dataset)
        )
        result: dict[str, object] = {
            "messages": [
                {
                    "role": "user",
                    "content": {"type": "text", "text": GUIDE_TEXT + compact_json(profiles)},
                }
            ]
        }
        assert_within_budget(result, self._budget)
        return result
