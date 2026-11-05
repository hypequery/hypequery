"""An authorized client-contract API reached over HTTPS.

Ports `@hypequery/mcp`'s HTTP bridge transport: HTTPS only (plain HTTP only on
loopback), no credentials, query or fragment in the discovery URL, one origin
for every request, redirects refused, and response bodies read within a byte
budget whatever `Content-Length` claims. Uses the standard library, so the
bridge adds no HTTP client dependency.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from email.message import Message
from typing import IO, NoReturn
from urllib.parse import SplitResult, urlsplit, urlunsplit

import anyio

from ..errors import McpToolError
from .base import BackendHeaders, BackendResponse, resolve_headers

_LOOPBACK = ("localhost", "127.0.0.1", "::1")


def _bad_url() -> NoReturn:
    raise ValueError(
        "Use an HTTPS discovery URL (HTTP is allowed only on loopback), "
        "without credentials, query or fragment."
    )


def backend_url(value: str) -> SplitResult:
    """Validate a client-contract discovery URL."""

    try:
        url = urlsplit(value)
        hostname = url.hostname
    except ValueError:
        _bad_url()
    if (
        hostname is None
        or not (url.scheme == "https" or (url.scheme == "http" and hostname in _LOOPBACK))
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
        or "?" in value
        or "#" in value
    ):
        _bad_url()
    return url


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: Message,
        newurl: str,
    ) -> None:
        return None


_OPENER = urllib.request.build_opener(_RefuseRedirects)


def _read(stream: IO[bytes], headers: Message, status: int, max_bytes: int) -> BackendResponse:
    content_type = headers.get("content-type")
    length = headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > max_bytes):
        return BackendResponse(status, content_type, oversized=True)
    body = stream.read(max_bytes + 1)
    return BackendResponse(status, content_type, body[:max_bytes], len(body) > max_bytes)


@dataclass(frozen=True, slots=True)
class HttpContractBackend:
    """Discover at *url* and post plans to endpoint paths on the same origin."""

    url: str
    headers: BackendHeaders | None = None
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        backend_url(self.url)

    def _origin(self) -> SplitResult:
        return backend_url(self.url)

    def _send(
        self, url: str, body: bytes | None, headers: Mapping[str, str], max_bytes: int
    ) -> BackendResponse:
        request = urllib.request.Request(  # noqa: S310 - scheme validated above
            url, data=body, headers=dict(headers), method="POST" if body is not None else "GET"
        )
        try:
            with _OPENER.open(request, timeout=self.timeout_seconds) as response:
                return _read(response, response.headers, response.status, max_bytes)
        except urllib.error.HTTPError as error:
            with error:
                return BackendResponse(error.code, error.headers.get("content-type"))
        except (OSError, ValueError):
            raise McpToolError(
                "MCP_EXECUTION_FAILED", "Backend request failed.", retryable=True
            ) from None

    async def _request(
        self,
        path: str | None,
        body: Mapping[str, object] | None,
        schema_hash: str | None,
        max_bytes: int,
    ) -> BackendResponse:
        origin = self._origin()
        if path is None:
            url = urlunsplit(origin)
        else:
            target = urlsplit(path)
            if target.scheme or target.netloc or not path.startswith("/"):
                raise McpToolError(
                    "MCP_EXECUTION_FAILED", "Backend origin changed.", retryable=False
                )
            url = urlunsplit((origin.scheme, origin.netloc, target.path, "", ""))
        headers = resolve_headers(self.headers)
        headers["accept"] = "application/json"
        encoded = None
        if body is not None:
            encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            headers["content-type"] = "application/json"
        if schema_hash is not None:
            headers["x-hypequery-client-schema"] = schema_hash
        return await anyio.to_thread.run_sync(
            lambda: self._send(url, encoded, headers, max_bytes), abandon_on_cancel=True
        )

    async def discover(self, max_bytes: int) -> BackendResponse:
        return await self._request(None, None, None, max_bytes)

    async def query(
        self, path: str, body: Mapping[str, object], schema_hash: str, max_bytes: int
    ) -> BackendResponse:
        return await self._request(path, body, schema_hash, max_bytes)
