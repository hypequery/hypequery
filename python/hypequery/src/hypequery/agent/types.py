"""The shapes every agent adapter shares. Nothing here imports an agent SDK."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol, TypeAlias

JsonObject: TypeAlias = dict[str, object]

#: A bearer token, or a function returning the current one (sync or async). The
#: function is called before every request, so a short-lived token (a minted
#: agent token lasts at most 15 minutes) can be replaced while tools stay in use.
Token: TypeAlias = str | Callable[[], str] | Callable[[], Awaitable[str]]


@dataclass(frozen=True)
class ToolDefinition:
    """One tool as the server lists it."""

    name: str
    #: The server's description, or `""` when it has none.
    description: str
    #: The server's JSON Schema for the arguments, unchanged.
    input_schema: JsonObject
    title: str | None = None
    output_schema: JsonObject | None = None
    annotations: JsonObject | None = None


@dataclass(frozen=True)
class ToolErrorDetails:
    """hypequery's MCP error envelope (`structuredContent.error` on a failed call)."""

    code: str
    category: str
    message: str
    retryable: bool
    correctable: bool
    retry_after_seconds: float | None = None
    #: Re-read discovery (`list_datasets`, schemas) before retrying.
    relist: bool | None = None
    #: The host's own stable code for this failure.
    reason: str | None = None
    #: The next action, in one sentence.
    hint: str | None = None
    docs_url: str | None = None
    #: The request id hypequery logged this call under.
    request_id: str | None = None

    def to_envelope(self) -> JsonObject:
        """The envelope as JSON, with the same camelCase keys as `@hypequery/agent`."""

        envelope: JsonObject = {
            "code": self.code,
            "category": self.category,
            "message": self.message,
            "retryable": self.retryable,
            "correctable": self.correctable,
        }
        optional: dict[str, object | None] = {
            "retryAfterSeconds": self.retry_after_seconds,
            "relist": self.relist,
            "reason": self.reason,
            "hint": self.hint,
            "docsUrl": self.docs_url,
            "requestId": self.request_id,
        }
        envelope.update({key: value for key, value in optional.items() if value is not None})
        return envelope


@dataclass(frozen=True)
class ToolSuccess:
    """A tool call that returned data."""

    tool: str
    #: `structuredContent`, or the text content parsed as JSON, or the text itself.
    data: object
    request_id: str | None = None
    #: The MCP `CallToolResult`, unchanged.
    raw: Mapping[str, object] = field(default_factory=dict, repr=False)
    ok: Literal[True] = True


@dataclass(frozen=True)
class ToolFailure:
    """A tool error the model can act on: bad input, an unknown dataset, a timeout."""

    tool: str
    error: ToolErrorDetails
    request_id: str | None = None
    raw: Mapping[str, object] = field(default_factory=dict, repr=False)
    ok: Literal[False] = False


#: A tool call's outcome. A tool error is a result, not an exception.
ToolResult: TypeAlias = ToolSuccess | ToolFailure

#: Called after every tool call with its result.
OnResult: TypeAlias = Callable[[ToolResult], None]


class ToolsClient(Protocol):
    """The tools, from an endpoint or an executor. Every adapter builds on one."""

    async def list_tools(self) -> list[ToolDefinition]:
        """The tools, listed once and cached."""
        ...

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> ToolResult:
        """Call a tool. Tool errors are `ToolFailure` results; transport and auth failures raise."""
        ...

    async def aclose(self) -> None:
        """Release anything the client holds."""
        ...


class ToolExecutor(Protocol):
    """An MCP tool executor in this process, such as `hypequery.mcp.ClientContractExecutor`.

    Structural, so `hypequery.agent` does not import `hypequery.mcp`.
    """

    async def list_tools(self) -> Mapping[str, object]: ...

    async def call_tool(
        self, name: str, arguments: Mapping[str, object] | None = None
    ) -> Mapping[str, object]: ...
