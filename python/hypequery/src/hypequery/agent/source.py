"""Every adapter takes its tools the same three ways: an executor, an endpoint, or a client."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import TypedDict, Unpack

from .clients.executor import ExecutorToolsClient
from .clients.remote import RemoteToolsClient
from .types import OnResult, Token, ToolExecutor, ToolsClient


class ToolsSource(TypedDict, total=False):
    """The keyword arguments every adapter's `hypequery_tools()` accepts."""

    client: ToolsClient
    executor: ToolExecutor
    url: str
    token: Token
    headers: Mapping[str, str]
    tools: Iterable[str]
    on_result: OnResult


def tools_client(**source: Unpack[ToolsSource]) -> ToolsClient:
    """`resolve_tools_client`, taking an adapter's keyword arguments as they were passed."""

    return resolve_tools_client(**source)


def resolve_tools_client(
    *,
    client: ToolsClient | None = None,
    executor: ToolExecutor | None = None,
    url: str | None = None,
    token: Token | None = None,
    headers: Mapping[str, str] | None = None,
    tools: Iterable[str] | None = None,
    on_result: OnResult | None = None,
) -> ToolsClient:
    """The client behind an adapter.

    - `executor=`: tools in this process, scoped by whoever the executor was
      built for. No endpoint, no token.
    - `url=` and `token=`: a tenant MCP endpoint, such as hypequery Cloud's.
    - `client=`: a client you built yourself.
    """

    chosen = [
        name
        for name, value in (("client", client), ("executor", executor), ("url", url))
        if value is not None
    ]
    if len(chosen) != 1:
        raise TypeError(
            "hypequery tools: pass exactly one of executor=, url= (with token=), or client=."
        )
    if client is not None:
        return client
    if executor is not None:
        if token is not None or headers is not None:
            raise TypeError(
                "hypequery tools: token= and headers= are for url=; an executor needs neither."
            )
        return ExecutorToolsClient(executor, tools=tools, on_result=on_result)
    if url is None or token is None:
        raise TypeError("hypequery tools: url= needs token=.")
    if tools is not None:
        raise TypeError(
            "hypequery tools: tools= limits an executor; the endpoint decides its own tools."
        )
    return RemoteToolsClient(url, token, headers=headers, on_result=on_result)
