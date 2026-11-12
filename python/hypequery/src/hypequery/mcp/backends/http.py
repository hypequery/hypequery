"""An authorized client-contract API reached over HTTPS.

Ports `@hypequery/mcp`'s HTTP bridge transport: HTTPS only (plain HTTP only on
loopback), no credentials, query or fragment in the discovery URL, one origin
for every request, redirects refused, and response bodies read within a byte
budget whatever `Content-Length` claims. Uses the standard library, so the
bridge adds no HTTP client dependency.
"""

from __future__ import annotations

import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from email.message import Message
from typing import IO, NoReturn
from urllib.parse import SplitResult, urlsplit, urlunsplit

import anyio

from ...protocol import CLIENT_CONTRACT_FEATURES, CLIENT_CONTRACT_FEATURES_HEADER
from ...serve.core.utils.http_deadline import (
    Deadline,
    DeadlineHTTPHandler,
    DeadlineHTTPSHandler,
    NoRedirects,
)
from ...serve.core.utils.http_proxy import with_default_ports
from ...serve.core.utils.jwt_options import LOOPBACK_HOSTS
from ..errors import McpToolError
from .base import BackendHeaders, BackendResponse, resolve_headers


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
        or not (url.scheme == "https" or (url.scheme == "http" and hostname in LOOPBACK_HOSTS))
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
        or "?" in value
        or "#" in value
    ):
        _bad_url()
    return url


def _opener(hostname: str | None, deadline: Deadline) -> urllib.request.OpenerDirector:
    # urllib honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY and tunnels https with
    # CONNECT, so TLS stays end to end. A loopback backend is reached directly:
    # plain HTTP through a proxy would hand it the credential in cleartext.
    proxies = {} if hostname in LOOPBACK_HOSTS else with_default_ports(urllib.request.getproxies())
    return urllib.request.build_opener(
        urllib.request.ProxyHandler(proxies),
        DeadlineHTTPHandler(deadline),
        DeadlineHTTPSHandler(deadline),
        NoRedirects,
    )


def _read(stream: IO[bytes], headers: Message, status: int, max_bytes: int) -> BackendResponse:
    content_type = headers.get("content-type")
    length = headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > max_bytes):
        return BackendResponse(status, content_type, oversized=True)
    body = stream.read(max_bytes + 1)
    return BackendResponse(status, content_type, body[:max_bytes], len(body) > max_bytes)


@dataclass(frozen=True, slots=True)
class HttpContractBackend:
    """Discover at *url* and post plans to endpoint paths on the same origin.

    Each request, from connecting to the last byte, ends by *timeout_seconds*.
    """

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
        # A socket timeout bounds each read, not the request. The deadline shuts
        # the connection down when it passes, so a worker the MCP call stopped
        # waiting for cannot keep reading from a slow backend.
        deadline = Deadline(self.timeout_seconds)
        try:
            with (
                deadline,
                _opener(urlsplit(url).hostname, deadline).open(
                    request, timeout=self.timeout_seconds
                ) as response,
            ):
                answer = _read(response, response.headers, response.status, max_bytes)
            if deadline.expired:
                # A shut-down connection reads as end of body, not an error.
                raise TimeoutError
            return answer
        except urllib.error.HTTPError as error:
            with error:
                return BackendResponse(error.code, error.headers.get("content-type"))
        except (OSError, ValueError, http.client.HTTPException):
            # Refused, timed out, or a malformed answer; never echo what it said.
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
        else:
            # Discovery: this executor validates field metadata, so it asks for it.
            headers[CLIENT_CONTRACT_FEATURES_HEADER] = CLIENT_CONTRACT_FEATURES
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
