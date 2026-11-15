"""Tools from a tenant MCP endpoint over Streamable HTTP, such as hypequery Cloud's.

Needs the MCP SDK, from the `mcp` extra: `pip install "hypequery[mcp]"`. It is
imported when a call is made, so `hypequery.agent` imports without it.
"""

from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any

from ..errors import HypequeryToolsError
from ..types import OnResult, Token, ToolDefinition, ToolErrorDetails, ToolResult
from ..utils.endpoint_url import tools_endpoint_url
from ..utils.results import read_error_envelope, to_arguments, to_definition, to_tool_result

_CLIENT_NAME = "hypequery-agent-python"


def _leaf(error: BaseException) -> BaseException:
    # The SDK runs each session in a task group, so failures arrive wrapped.
    while isinstance(error, BaseExceptionGroup) and error.exceptions:
        error = error.exceptions[0]
    return error


class _Refusal:
    """The endpoint's last error response. The SDK reports a refused request only
    as a generic protocol error, so the status and body are taken from HTTP."""

    __slots__ = ("body", "status")

    def __init__(self) -> None:
        self.status: int | None = None
        self.body: object = None

    async def record(self, response: Any) -> None:
        status = getattr(response, "status_code", None)
        if not isinstance(status, int) or status < 400:
            return
        self.status = status
        try:
            await response.aread()
            self.body = response.json()
        except Exception:
            self.body = None


def to_tools_error(error: BaseException, refusal: _Refusal | None = None) -> HypequeryToolsError:
    """A transport or protocol failure as `HypequeryToolsError`, keeping the endpoint's envelope."""

    error = _leaf(error)
    if isinstance(error, HypequeryToolsError):
        return error
    status = refusal.status if refusal is not None else None
    body = refusal.body if refusal is not None else None
    envelope: ToolErrorDetails | None = None
    if isinstance(body, Mapping):
        envelope = read_error_envelope(body.get("error")) or read_error_envelope(body)
    if envelope is None:
        if status in (401, 403):
            code, category, retryable = "MCP_UNAUTHORIZED", "unauthorized", False
            message = "The endpoint refused the token."
        elif status == 429:
            code, category, retryable = "MCP_RATE_LIMITED", "budget", True
            message = "The endpoint is rate limiting this token."
        else:
            code, category, retryable = "MCP_EXECUTION_FAILED", "internal", True
            message = str(error) or type(error).__name__
        envelope = ToolErrorDetails(
            code=code, category=category, message=message, retryable=retryable, correctable=False
        )
    tools_error = HypequeryToolsError(envelope, status=status)
    tools_error.__cause__ = error
    return tools_error


class RemoteToolsClient:
    """The tools of one tenant MCP endpoint, called over Streamable HTTP.

    Each operation opens a short MCP session, so a token function is asked for
    a fresh token every time and there is no session to keep alive or close.
    """

    def __init__(
        self,
        url: str,
        token: Token,
        *,
        headers: Mapping[str, str] | None = None,
        on_result: OnResult | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._url = tools_endpoint_url(url)
        if not isinstance(token, str) and not callable(token):
            raise TypeError("hypequery tools: token must be a string or a function returning one.")
        self._token = token
        self._headers = dict(headers or {})
        self._on_result = on_result
        self._timeout = timeout
        self._tools: list[ToolDefinition] | None = None

    async def _bearer(self) -> str:
        token: object = self._token() if callable(self._token) else self._token
        if inspect.isawaitable(token):
            token = await token
        if not isinstance(token, str) or not token.strip():
            # Not retryable: the same call would send the same empty token.
            raise HypequeryToolsError(
                ToolErrorDetails(
                    code="MCP_UNAUTHORIZED",
                    category="unauthorized",
                    message="hypequery tools: token is empty.",
                    retryable=False,
                    correctable=False,
                )
            )
        return token.strip()

    async def _session(self) -> tuple[Any, Any, _Refusal]:
        try:
            import httpx2
            from mcp import Client
            from mcp.client.streamable_http import streamable_http_client
        except ImportError as error:  # pragma: no cover - exercised without the extra
            raise ImportError(
                'hypequery tools over HTTP need the MCP SDK: pip install "hypequery[mcp]"'
            ) from error
        headers = {**self._headers, "authorization": f"Bearer {await self._bearer()}"}
        refusal = _Refusal()
        http = httpx2.AsyncClient(
            headers=headers, timeout=self._timeout, event_hooks={"response": [refusal.record]}
        )
        return http, Client(streamable_http_client(self._url, http_client=http)), refusal

    async def list_tools(self) -> list[ToolDefinition]:
        if self._tools is None:
            http, session, refusal = await self._session()
            try:
                async with http, session as client:
                    tools: list[ToolDefinition] = []
                    cursor: str | None = None
                    while True:
                        page = await client.list_tools(cursor=cursor)
                        tools.extend(
                            to_definition(
                                tool.model_dump(by_alias=True, exclude_none=True, mode="json")
                            )
                            for tool in page.tools
                        )
                        cursor = page.next_cursor
                        if not cursor:
                            break
            except Exception as error:
                raise to_tools_error(error, refusal) from error
            self._tools = tools
        return list(self._tools)

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> ToolResult:
        args = to_arguments(name, arguments)
        http, session, refusal = await self._session()
        try:
            async with http, session as client:
                raw = await client.call_tool(name, args)
        except Exception as error:
            raise to_tools_error(error, refusal) from error
        result = to_tool_result(name, raw.model_dump(by_alias=True, exclude_none=True, mode="json"))
        if self._on_result is not None:
            self._on_result(result)
        return result

    async def aclose(self) -> None:
        # Sessions close with each operation.
        return None
