"""The MCP bridge to an API served over HTTP, against a real loopback server."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from contextlib import suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import cast

import pytest

from hypequery.mcp import ClientContractExecutor, HttpContractBackend, McpToolError
from hypequery.serve.core.messages import Headers, ServeRequest
from mcp_support import READER, build_api


def _serve(api_handle: object) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:  # silence test output
            pass

        def _answer(self) -> None:
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("location", "https://elsewhere.example/client-contract")
                self.end_headers()
                return
            if self.path == "/text":
                body = b"not json"
                self.send_response(200)
                self.send_header("content-type", "text/plain")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length) if length else b""
            headers = [(name.lower(), value) for name, value in self.headers.items()]
            headers = [(n, v) for n, v in headers if n != "host"] + [
                ("host", "analytics.example.com")
            ]
            request = ServeRequest(
                method=self.command, path=self.path, headers=Headers(headers), body=body
            )
            response = asyncio.run(api_handle(request))  # type: ignore[operator]
            self.send_response(response.status)
            for name, value in response.headers.items():
                self.send_header(name, value)
            self.send_header("content-length", str(len(response.body)))
            self.end_headers()
            self.wfile.write(response.body)

        do_GET = _answer  # noqa: N815 - http.server's method names
        do_POST = _answer  # noqa: N815

    return Handler


@pytest.fixture
def origin() -> Iterator[str]:
    api, _ = build_api()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _serve(api.handle))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def connect(url: str, **options: object) -> ClientContractExecutor:
    backend = HttpContractBackend(url, headers=READER)
    return asyncio.run(ClientContractExecutor.create(backend, **options))  # type: ignore[arg-type]


def test_tools_run_over_http(origin: str) -> None:
    executor = connect(origin + "/client-contract")
    result = asyncio.run(
        executor.call_tool(
            "query_dataset", {"dataset": "orders", "dimensions": ["country"], "measures": ["total"]}
        )
    )
    assert "isError" not in result
    data = cast(dict[str, object], result["structuredContent"])["data"]
    assert data == [{"country": "US", "total": "10"}] * 3


def test_redirects_are_refused(origin: str) -> None:
    with pytest.raises(McpToolError) as raised:
        connect(origin + "/redirect")
    assert raised.value.code == "MCP_EXECUTION_FAILED"


def test_a_non_json_answer_is_refused(origin: str) -> None:
    with pytest.raises(McpToolError, match="did not return JSON"):
        connect(origin + "/text")


def test_the_contract_is_read_within_its_byte_budget(origin: str) -> None:
    with pytest.raises(McpToolError) as raised:
        connect(origin + "/client-contract", max_contract_bytes=64)
    assert raised.value.code == "MCP_RESULT_TOO_LARGE"


def test_a_bad_credential_is_unauthorized(origin: str) -> None:
    backend = HttpContractBackend(
        origin + "/client-contract", headers={"authorization": "Bearer x"}
    )
    with pytest.raises(McpToolError) as raised:
        asyncio.run(ClientContractExecutor.create(backend))
    assert raised.value.code == "MCP_UNAUTHORIZED"


def test_an_unreachable_backend_is_a_retryable_failure() -> None:
    backend = HttpContractBackend("http://127.0.0.1:9/client-contract", timeout_seconds=1)
    with pytest.raises(McpToolError) as raised:
        asyncio.run(ClientContractExecutor.create(backend))
    assert raised.value.code == "MCP_EXECUTION_FAILED"
    assert raised.value.retryable


@pytest.mark.parametrize("path", ["//evil.example/orders", "https://evil.example/orders", "orders"])
def test_queries_never_leave_the_discovery_origin(path: str) -> None:
    backend = HttpContractBackend("https://analytics.example.com/client-contract")
    with pytest.raises(McpToolError, match="origin changed"):
        asyncio.run(backend.query(path, {}, "hash", 1024))


@pytest.mark.parametrize(
    "url",
    [
        "http://analytics.example.com/client-contract",
        "https://user:secret@analytics.example.com/client-contract",
        "https://analytics.example.com/client-contract?view=build",
        "https://analytics.example.com/client-contract#fragment",
        "ftp://analytics.example.com/client-contract",
        "not a url",
    ],
)
def test_discovery_urls_must_be_https_without_credentials_query_or_fragment(url: str) -> None:
    with pytest.raises(ValueError, match="HTTPS discovery URL"):
        HttpContractBackend(url)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_plain_http_is_allowed_only_on_loopback(host: str) -> None:
    HttpContractBackend(f"http://{host}:8000/client-contract")


def test_a_loopback_backend_is_reached_directly_whatever_the_proxy(
    origin: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A proxy would receive the bearer token in cleartext; this one does not exist.
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    executor = connect(origin + "/client-contract")
    assert executor.contract["endpoints"]


def test_a_malformed_answer_is_a_safe_failure() -> None:
    import socket

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)

    def answer() -> None:
        connection, _ = listener.accept()
        connection.recv(65536)
        connection.sendall(b"HTTP/1.1 2xx secret-token-abc\r\n\r\n")
        connection.close()

    thread = threading.Thread(target=answer, daemon=True)
    thread.start()
    backend = HttpContractBackend(
        f"http://127.0.0.1:{listener.getsockname()[1]}/client-contract", timeout_seconds=5
    )
    with pytest.raises(McpToolError) as raised:
        asyncio.run(ClientContractExecutor.create(backend))
    listener.close()
    assert raised.value.code == "MCP_EXECUTION_FAILED"
    assert "secret" not in raised.value.message


def test_a_trickling_backend_is_cut_off_at_the_deadline() -> None:
    import socket
    import time

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    stop = threading.Event()

    def trickle() -> None:
        connection, _ = listener.accept()
        connection.recv(65536)
        connection.sendall(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n")
        # Each byte arrives well inside the socket timeout; only the request
        # deadline can end the read.
        with suppress(OSError):
            while not stop.is_set():
                connection.sendall(b" ")
                time.sleep(0.05)
        connection.close()

    thread = threading.Thread(target=trickle, daemon=True)
    thread.start()
    backend = HttpContractBackend(
        f"http://127.0.0.1:{listener.getsockname()[1]}/client-contract", timeout_seconds=0.5
    )
    started = time.monotonic()
    with pytest.raises(McpToolError) as raised:
        asyncio.run(backend.discover(1_000_000))
    stop.set()
    listener.close()
    assert raised.value.code == "MCP_EXECUTION_FAILED"
    assert time.monotonic() - started < 3
