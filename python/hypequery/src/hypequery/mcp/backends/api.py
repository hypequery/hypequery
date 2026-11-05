"""An `Api` served in this process: the same pipeline as HTTP, without a socket.

Every tool call becomes a synthetic `ServeRequest` through `Api.handle`, so
authentication, tenant resolution, endpoint policy, rate limits and the
`409 CLIENT_SCHEMA_CHANGED` check are exactly the ones an HTTP caller meets.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field

from ...serve import Api
from ...serve.core.messages import Headers, ServeRequest
from ..errors import McpToolError
from .base import BackendHeaders, BackendResponse, resolve_headers

#: The module whose route serves a live authorized client contract.
_DISCOVERY_MODULE = "hypequery.serve.core.client_discovery"


def discovery_path(api: Api) -> str:
    """The path *api* serves its authenticated client contract at.

    A public discovery route projects only anonymous capabilities, so an
    authenticated one is preferred. The API is never changed: a route added
    here would go live wherever the same API is also served over HTTP.
    """

    routes = [
        route
        for route in api.routes
        if route.method == "GET" and getattr(route.handler, "__module__", "") == _DISCOVERY_MODULE
    ]
    if not routes:
        raise ValueError(
            "The API serves no client contract; call add_client_contract_endpoint(api) "
            "and give its endpoints client_profile=ClientQueryProfile()."
        )
    return min(routes, key=lambda route: route.public).path


def request_host(api: Api) -> str:
    """A `Host` the API's security profile accepts."""

    if api.security is None:
        return "localhost"
    for pattern in api.security.allowed_hosts:
        if not pattern.startswith("*."):
            return pattern
    return "mcp." + api.security.allowed_hosts[0][2:]


@dataclass(slots=True)
class ApiContractBackend:
    """Discover and query *api* in-process, as the principal *headers* authenticate."""

    api: Api
    headers: BackendHeaders | None = None
    _discovery: str = field(init=False)
    _host: str = field(init=False)

    def __post_init__(self) -> None:
        if not isinstance(self.api, Api):
            raise TypeError("ApiContractBackend serves a hypequery.serve Api")
        self._discovery = discovery_path(self.api)
        self._host = request_host(self.api)

    def _route_path(self, path: str) -> str:
        # Contract paths name where clients reach the API; strip the mount prefix.
        prefix = self.api.client_mount_path
        if prefix and path.startswith(prefix + "/"):
            return path[len(prefix) :]
        if prefix or not path.startswith("/"):
            raise McpToolError("MCP_EXECUTION_FAILED", "Backend origin changed.", retryable=False)
        return path

    async def _send(
        self, method: str, path: str, body: bytes, headers: dict[str, str], max_bytes: int
    ) -> BackendResponse:
        headers["host"] = self._host
        headers["accept"] = "application/json"
        if body:
            headers["content-type"] = "application/json"
            headers["content-length"] = str(len(body))
        request = ServeRequest(
            method=method,
            path=path,
            headers=Headers(headers.items()),
            body=body,
            client=("127.0.0.1", 0),
            scheme="https",
        )
        response = await self.api.handle(request)
        content = response.body
        return BackendResponse(
            response.status,
            response.headers.get("content-type"),
            content[:max_bytes],
            len(content) > max_bytes,
        )

    async def discover(self, max_bytes: int) -> BackendResponse:
        return await self._send(
            "GET", self._discovery, b"", resolve_headers(self.headers), max_bytes
        )

    async def query(
        self, path: str, body: Mapping[str, object], schema_hash: str, max_bytes: int
    ) -> BackendResponse:
        headers = resolve_headers(self.headers)
        headers["x-hypequery-client-schema"] = schema_hash
        encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return await self._send("POST", self._route_path(path), encoded, headers, max_bytes)
