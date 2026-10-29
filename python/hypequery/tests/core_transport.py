"""Drive the framework-neutral serving core directly, with no HTTP server.

`CoreClient` speaks the slice of `AsgiClient`'s interface the shared HTTP
fixture tests use, so one test body checks both `Api.handle` and the ASGI
adapter. Like `AsgiClient`, it sends `Host: testserver` unless told otherwise,
from the peer address `testclient:50000`.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from hypequery.serve.core import Api, Headers, ServeRequest


class CoreClient:
    def __init__(
        self, api: Api, *, client: tuple[str, int] = ("testclient", 50000), scheme: str = "http"
    ) -> None:
        self.api = api
        self.client = client
        self.scheme = scheme

    def request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        json: Any = None,
        content: bytes | None = None,
    ) -> httpx.Response:
        sent = [(name.lower(), value) for name, value in (headers or {}).items()]
        if not any(name == "host" for name, _ in sent):
            sent.insert(0, ("host", "testserver"))
        body = content or b""
        if json is not None:
            body = _encode(json)
            sent.append(("content-type", "application/json"))
        if body:
            sent.append(("content-length", str(len(body))))
        request = ServeRequest(
            method=method,
            path=path,
            headers=Headers(sent),
            body=body,
            client=self.client,
            scheme=self.scheme,
        )
        response = asyncio.run(self.api.handle(request))
        return httpx.Response(
            response.status, headers=list(response.headers.items()), content=response.body
        )

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", path, **kwargs)


def _encode(value: Any) -> bytes:
    return json.dumps(value).encode("utf-8")
