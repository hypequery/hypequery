"""Drive the framework-neutral serving core directly, with no HTTP server.

`CoreClient` speaks the slice of `TestClient`'s interface the shared HTTP
fixture tests use, so one test body checks both the FastAPI application and
`Api.handle`.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from hypequery.serve.core import Api, Headers, ServeRequest


class CoreClient:
    def __init__(self, api: Api) -> None:
        self.api = api

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
        body = content or b""
        if json is not None:
            body = _encode(json)
            sent.append(("content-type", "application/json"))
        if body:
            sent.append(("content-length", str(len(body))))
        request = ServeRequest(method=method, path=path, headers=Headers(sent), body=body)
        response = asyncio.run(self.api.handle(request))
        return httpx.Response(
            response.status, headers=list(response.headers.items()), content=response.body
        )


def _encode(value: Any) -> bytes:
    return json.dumps(value).encode("utf-8")
