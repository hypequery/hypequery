"""The WSGI adapter: the environ, bodies, the process's serving loop, and a real server."""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import io
import logging
import os
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from socketserver import ThreadingMixIn
from typing import Any
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

import httpx
import pytest
from pydantic import TypeAdapter

from hypequery.serve import (
    Api,
    Call,
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    ServeRequest,
    ServeResponse,
    WsgiApp,
    create_api,
    export_client_contract,
    to_wsgi_app,
)
from hypequery.serve.utils import serving_loop as serving
from hypequery.serve.utils.response_head import response_headers, status_line
from hypequery.serve.utils.serving_loop import RequestThread, ServingLoop
from hypequery.serve.utils.thread_body import CHUNK_BYTES
from hypequery.serve.utils.wsgi_environ import (
    body_length,
    environ_client,
    environ_headers,
    path_below,
    request_target_path,
)
from wsgi_client import WsgiClient, call, environ

AUTH = ("authorization", "Bearer reader")
JSON = ("content-type", "application/json")


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


def _api(**options: Any) -> Api:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json(
            {
                "input": call.input,
                "query": call.request.query.items(),
                "client": call.request.client,
                "path": call.request.path,
            }
        )

    async def headers(call: Call) -> ServeResponse:
        return ServeResponse.json(call.request.headers.items())

    async def where(call: Call) -> ServeResponse:
        return ServeResponse.json(
            {
                "loop": id(asyncio.get_running_loop()),
                "thread": threading.get_ident(),
                "raw": type(call.request.raw).__name__,
            }
        )

    api = create_api(auth=_authenticate, **options)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    api.add_route("GET", "/echo", echo)
    api.add_route("GET", "/headers", headers)
    api.add_route("GET", "/where", where)
    return api


class Stream:
    """A `wsgi.input` that records the reads made of it and the threads they ran on."""

    def __init__(self, body: bytes = b"", *, refuse: bool = False) -> None:
        self._body = io.BytesIO(body)
        self.refuse = refuse
        self.reads: list[int] = []
        self.threads: set[int] = set()

    def read(self, size: int = -1) -> bytes:
        if self.refuse:
            raise AssertionError("the body must not be read")
        self.reads.append(size)
        self.threads.add(threading.get_ident())
        return self._body.read(size)


class Endless:
    """A chunked body that never ends, as an abusive caller would send it."""

    def __init__(self) -> None:
        self.read_bytes = 0

    def read(self, size: int = -1) -> bytes:
        self.read_bytes += size
        return b"x" * size


def _post(
    app: WsgiApp, stream: Any, headers: list[tuple[str, str]], **extra: Any
) -> httpx.Response:
    built = environ(
        "POST", "/echo", headers=[("host", "testserver"), *headers], input_stream=stream
    )
    built.update(extra)
    return call(app, built)


# --- the environ ----------------------------------------------------------


def test_headers_come_from_http_variables_and_the_cgi_body_variables() -> None:
    headers = environ_headers(
        {
            "HTTP_HOST": "testserver",
            "HTTP_X_CUSTOM_NAME": "a",
            "HTTP_ACCEPT": "text/html,application/json",
            "CONTENT_TYPE": "application/json",
            "CONTENT_LENGTH": "2",
            # Some servers repeat the body variables with the prefix.
            "HTTP_CONTENT_TYPE": "text/plain",
            "HTTP_CONTENT_LENGTH": "99",
            "REQUEST_METHOD": "GET",
            "wsgi.input": None,
        }
    )
    assert sorted(headers.items()) == [
        ("accept", "text/html,application/json"),
        ("content-length", "2"),
        ("content-type", "application/json"),
        ("host", "testserver"),
        ("x-custom-name", "a"),
    ]
    # CGI servers set the body variables empty when a request has no body.
    assert environ_headers({"CONTENT_TYPE": "", "CONTENT_LENGTH": ""}).items() == ()


@pytest.mark.parametrize(
    ("variables", "host"),
    [
        ({"HTTP_HOST": "api.test", "SERVER_NAME": "internal"}, "api.test"),
        ({"SERVER_NAME": "testserver", "SERVER_PORT": "80"}, "testserver"),
        ({"SERVER_NAME": "testserver", "SERVER_PORT": "8000"}, "testserver:8000"),
        (
            {"SERVER_NAME": "api.test", "SERVER_PORT": "443", "wsgi.url_scheme": "https"},
            "api.test",
        ),
        (
            {"SERVER_NAME": "api.test", "SERVER_PORT": "80", "wsgi.url_scheme": "https"},
            "api.test:80",
        ),
        ({"SERVER_NAME": "api.test"}, "api.test"),
        ({}, None),
    ],
)
def test_a_request_without_host_is_addressed_to_the_server(
    variables: dict[str, str], host: str | None
) -> None:
    assert environ_headers(variables).getlist("host") == ([host] if host else [])


def test_a_repeated_header_stays_the_one_value_the_server_joined() -> None:
    response = WsgiClient(to_wsgi_app(_api())).get(
        "/headers", headers=[AUTH, ("x-many", "a"), ("x-many", "b")]
    )
    assert ["x-many", "a,b"] in response.json()


def test_a_repeated_content_length_is_refused_before_the_body_is_read() -> None:
    stream = Stream(refuse=True)
    response = _post(to_wsgi_app(_api()), stream, [AUTH, JSON], CONTENT_LENGTH="2,2")
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "The request has an invalid Content-Length."


@pytest.mark.parametrize(
    ("variables", "client"),
    [
        ({"REMOTE_ADDR": "203.0.113.9", "REMOTE_PORT": "5000"}, ("203.0.113.9", 5000)),
        ({"REMOTE_ADDR": "203.0.113.9"}, ("203.0.113.9", 0)),
        ({"REMOTE_ADDR": "::1", "REMOTE_PORT": "x"}, ("::1", 0)),
        ({"REMOTE_ADDR": ""}, None),
        ({}, None),
    ],
)
def test_the_client_is_the_remote_address(
    variables: dict[str, str], client: tuple[str, int] | None
) -> None:
    assert environ_client(variables) == client


@pytest.mark.parametrize(
    ("variables", "path"),
    [
        ({"RAW_URI": "/a%20b?x=1#f"}, "/a%20b"),
        ({"REQUEST_URI": "/api/x?y"}, "/api/x"),
        ({"RAW_URI": "http://example.com/a/b?c"}, "/a/b"),
        ({"RAW_URI": "http://example.com"}, "/"),
        ({"RAW_URI": "*"}, None),
        ({"RAW_URI": "1http://example.com/a"}, None),
        ({"RAW_URI": ""}, None),
        ({}, None),
    ],
)
def test_the_request_target_is_read_when_the_server_passes_it(
    variables: dict[str, str], path: str | None
) -> None:
    assert request_target_path(variables) == path


@pytest.mark.parametrize(
    ("raw", "mount", "below"),
    [
        ("/x", "", "/x"),
        ("x", "", None),
        ("/api/x", "/api", "/x"),
        ("/api", "/api", "/"),
        ("/%61pi/x%20y", "/api", "/x%20y"),
        ("/a/b/c", "/a/b", "/c"),
        ("/apix", "/api", None),
        ("/other/x", "/api", None),
        ("/a%2Fb/c", "/a/b", "/c"),
    ],
)
def test_the_raw_path_below_a_decoded_mount(raw: str, mount: str, below: str | None) -> None:
    assert path_below(raw, mount) == below


@pytest.mark.parametrize(
    ("variables", "length"),
    [
        ({"CONTENT_LENGTH": "12"}, 12),
        ({"CONTENT_LENGTH": "0"}, 0),
        ({"CONTENT_LENGTH": "-1"}, 0),
        ({"CONTENT_LENGTH": "1,1"}, 0),
        ({"CONTENT_LENGTH": "", "wsgi.input_terminated": True}, None),
        ({"wsgi.input_terminated": True}, None),
        ({}, 0),
    ],
)
def test_the_body_length_is_declared_or_framed_by_the_server(
    variables: dict[str, Any], length: int | None
) -> None:
    assert body_length(variables) == length


@pytest.mark.parametrize(
    ("url", "script_name", "raw_uri", "path"),
    [
        ("/echo", "", True, "/echo"),
        ("/echo", "/api", True, "/echo"),
        ("/echo", "/api", False, "/echo"),
        # The target spells the path differently: matched as sent, as ASGI does.
        ("/%65cho", "", True, "/%65cho"),
        ("/%65cho", "", False, "/echo"),
        ("/%65cho", "/a%20pi", True, "/%65cho"),
    ],
)
def test_the_path_is_below_the_script_name_and_as_sent(
    url: str, script_name: str, raw_uri: bool, path: str
) -> None:
    client = WsgiClient(to_wsgi_app(_api()), script_name=script_name, raw_uri=raw_uri)
    response = client.get(url, headers=[AUTH])
    if path == "/echo":
        assert response.json()["path"] == "/echo"
    else:
        assert response.status_code == 404
        assert response.json()["error"]["message"] == f"No endpoint registered for GET {path}"


def test_the_query_and_peer_reach_the_core() -> None:
    client = WsgiClient(to_wsgi_app(_api()), client=("203.0.113.9", 5000))
    body = client.get("/echo?a=1&a=2&b=&c=%C3%A9", headers=[AUTH]).json()
    assert body["query"] == [["a", "1"], ["a", "2"], ["b", ""], ["c", "é"]]
    assert body["client"] == ["203.0.113.9", 5000]


# --- bodies ---------------------------------------------------------------


def test_the_body_is_read_on_the_request_thread_in_bounded_chunks() -> None:
    payload = b'{"x": "' + b"y" * (CHUNK_BYTES + 10) + b'"}'
    stream = Stream(payload)
    caller = threading.get_ident()
    response = _post(
        to_wsgi_app(_api(max_body_bytes=1 << 20)),
        stream,
        [AUTH, JSON, ("content-length", str(len(payload)))],
    )
    assert response.status_code == 200
    assert response.json()["input"] == {"x": "y" * (CHUNK_BYTES + 10)}
    assert stream.threads == {caller}
    # Never more than declared: the second read asks for exactly what remains.
    assert stream.reads == [CHUNK_BYTES, len(payload) - CHUNK_BYTES]


def test_a_chunked_body_the_server_framed_is_read_to_its_end() -> None:
    stream = Stream(b'{"x": 1}')
    response = _post(
        to_wsgi_app(_api()),
        stream,
        [AUTH, JSON, ("transfer-encoding", "chunked")],
        **{"wsgi.input_terminated": True},
    )
    assert response.status_code == 200
    assert response.json()["input"] == {"x": 1}


def test_an_endless_chunked_body_stops_being_read_at_the_limit() -> None:
    stream = Endless()
    response = _post(
        to_wsgi_app(_api(max_body_bytes=100_000)),
        stream,
        [AUTH, JSON, ("transfer-encoding", "chunked")],
        **{"wsgi.input_terminated": True},
    )
    assert response.status_code == 413
    assert stream.read_bytes <= 100_000 + CHUNK_BYTES


def test_without_a_length_or_framing_no_body_is_read() -> None:
    # wsgiref, for one, cannot frame a chunked body: reading would block.
    stream = Stream(refuse=True)
    response = _post(to_wsgi_app(_api()), stream, [AUTH, JSON, ("transfer-encoding", "chunked")])
    assert response.status_code == 400
    assert response.json()["error"]["details"]["issues"][0]["code"] == "missing"


def test_a_declared_length_over_the_limit_is_refused_unread() -> None:
    stream = Stream(refuse=True)
    response = _post(
        to_wsgi_app(_api(max_body_bytes=64)), stream, [AUTH, JSON, ("content-length", "65")]
    )
    assert response.status_code == 413


@pytest.mark.parametrize("path", ["/echo", "/where"])
def test_an_unauthenticated_or_bodiless_route_never_reads_the_body(path: str) -> None:
    app = to_wsgi_app(_api())
    stream = Stream(refuse=True)
    built = environ(
        "POST",
        "/echo",
        headers=[("host", "testserver"), JSON, ("content-length", "8")],
        input_stream=stream,
    )
    assert call(app, built).status_code == 401
    built = environ(
        "GET",
        path,
        headers=[("host", "testserver"), AUTH, JSON, ("content-length", "8")],
        input_stream=stream,
    )
    assert call(app, built).status_code == 200


def test_a_body_that_ends_early_is_caller_input() -> None:
    stream = Stream(b'{"x"')
    response = _post(to_wsgi_app(_api()), stream, [AUTH, JSON, ("content-length", "100")])
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "There was an error parsing the body"


def test_a_stalled_upload_ends_at_the_deadline_after_its_one_read_in_flight() -> None:
    # WSGI gives no way to interrupt a read of `wsgi.input` without corrupting
    # the connection; the server's own read timeout bounds that one read. The
    # deadline answers 504 and stops every read after it.
    class Stalled:
        def __init__(self) -> None:
            self.reads = 0

        def read(self, size: int = -1) -> bytes:
            self.reads += 1
            time.sleep(1.5)
            return b'{"x"'

    stream = Stalled()
    api = _api(
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile(timeout_seconds=1),
    )
    started = time.monotonic()
    response = _post(to_wsgi_app(api), stream, [AUTH, JSON, ("content-length", "100000")])
    elapsed = time.monotonic() - started
    assert response.status_code == 504
    assert response.json()["error"]["type"] == "GATEWAY_TIMEOUT"
    assert stream.reads == 1
    assert 1.4 < elapsed < 3


def test_a_failing_stream_is_caller_input() -> None:
    class Broken:
        def read(self, size: int = -1) -> bytes:
            raise OSError("connection reset")

    response = _post(to_wsgi_app(_api()), Broken(), [AUTH, JSON, ("content-length", "8")])
    assert response.status_code == 400


# --- the wire -------------------------------------------------------------


def test_status_lines_and_headers_are_written_as_wsgi_expects() -> None:
    assert status_line(200) == "200 OK"
    # The phrase is the running Python's, as wsgiref and Django write it: 3.13
    # renamed 413 to "Content Too Large". Clients read only the code.
    assert status_line(413) == f"413 {HTTPStatus(413).phrase}"
    assert status_line(599) == "599 "
    assert response_headers(ServeResponse(204, {"x": "1"}, b"")) == [("x", "1")]
    assert response_headers(ServeResponse(200, {"x": "1"}, b"ab")) == [
        ("x", "1"),
        ("content-length", "2"),
    ]


def test_a_bodiless_status_is_written_without_a_body() -> None:
    async def empty(call: Call) -> ServeResponse:
        return ServeResponse(status=304, headers={"etag": "x"}, body=b"stale")

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/empty", empty, public=True)
    response = WsgiClient(to_wsgi_app(api)).get("/empty")
    assert response.status_code == 304
    assert response.content == b""
    assert "content-length" not in response.headers


def test_a_fault_in_the_core_is_answered_without_detail(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    app = to_wsgi_app(_api())

    async def broken(request: ServeRequest, *, mounted_at: str | None = None) -> None:
        raise RuntimeError("SECRET")

    monkeypatch.setattr(app.api, "handle", broken)
    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        response = WsgiClient(app).get("/echo", headers=[AUTH])
    assert response.status_code == 500
    assert b"SECRET" not in response.content
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] in caplog.text


def test_to_wsgi_app_checks_its_argument_and_the_client_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(TypeError, match="create_api"):
        to_wsgi_app(object())  # type: ignore[arg-type]
    api = create_api(auth=_authenticate)
    checked: list[Api] = []
    monkeypatch.setattr(
        "hypequery.serve.client_contract.export_client_contract", lambda api: checked.append(api)
    )
    to_wsgi_app(api)
    assert checked == []
    monkeypatch.setattr(type(api.client_endpoints), "bindings", property(lambda self: (object(),)))
    to_wsgi_app(api)
    assert checked == [api]


def test_a_contract_is_exported_from_the_wsgi_app() -> None:
    app = to_wsgi_app(create_api(auth=_authenticate))
    assert export_client_contract(app) == export_client_contract(app.api)


# --- the serving loop -----------------------------------------------------


def test_every_request_runs_on_the_one_process_loop_off_its_own_thread() -> None:
    app = to_wsgi_app(_api())

    def where(_: int) -> tuple[dict[str, Any], int]:
        return WsgiClient(app).get("/where", headers=[AUTH]).json(), threading.get_ident()

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(where, range(64)))
    loops = {served["loop"] for served, _ in results}
    assert len(loops) == 1
    assert loops == {id(serving.serving_loop().loop)}
    assert all(served["thread"] != caller for served, caller in results)
    assert {served["raw"] for served, _ in results} == {"dict"}


def test_requests_on_many_threads_run_concurrently_on_the_loop() -> None:
    entered = 0
    all_in = asyncio.Event()

    async def gather(call: Call) -> ServeResponse:
        nonlocal entered
        entered += 1
        if entered == 8:
            all_in.set()
        # Every request waits for all eight: only concurrency can finish this.
        await asyncio.wait_for(all_in.wait(), 5)
        return ServeResponse.json({"ok": True})

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/gather", gather, public=True)
    app = to_wsgi_app(api)
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda _: WsgiClient(app).get("/gather").status_code, range(8)))
    assert statuses == [200] * 8


def test_the_caller_context_is_carried_into_the_core() -> None:
    marker: contextvars.ContextVar[str] = contextvars.ContextVar("marker", default="unset")

    async def read(call: Call) -> ServeResponse:
        return ServeResponse.json({"marker": marker.get()})

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/marker", read, public=True)
    token = marker.set("from the request thread")
    try:
        assert WsgiClient(to_wsgi_app(api)).get("/marker").json() == {
            "marker": "from the request thread"
        }
    finally:
        marker.reset(token)


def test_an_interrupted_request_thread_cancels_its_coroutine() -> None:
    loop = ServingLoop()
    cancelled = threading.Event()

    def interrupt() -> bytes:
        raise KeyboardInterrupt

    async def serve(thread: RequestThread) -> None:
        try:
            await thread.call(interrupt)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    try:
        with pytest.raises(KeyboardInterrupt):
            loop.run(serve)
        assert cancelled.wait(5)
    finally:
        loop.close()


def test_an_exception_on_the_request_thread_is_raised_in_the_coroutine() -> None:
    loop = ServingLoop()

    def fail() -> bytes:
        raise OSError("reset")

    async def serve(thread: RequestThread) -> str:
        try:
            await thread.call(fail)
        except OSError as exc:
            return str(exc)
        return "unreached"

    try:
        assert loop.run(serve) == "reset"
    finally:
        loop.close()


def test_a_coroutine_that_cannot_start_raises_on_the_request_thread() -> None:
    loop = ServingLoop()

    def not_a_coroutine(thread: RequestThread) -> Any:
        raise ValueError("bad factory")

    try:
        with pytest.raises(ValueError, match="bad factory"):
            loop.run(not_a_coroutine)
    finally:
        loop.close()


def test_the_loop_refuses_to_wait_on_itself() -> None:
    loop = ServingLoop()

    async def inner(thread: RequestThread) -> None:
        return None

    async def outer() -> None:
        loop.run(inner)

    try:
        with pytest.raises(RuntimeError, match="its own serving loop"):
            asyncio.run_coroutine_threadsafe(outer(), loop.loop).result(5)
    finally:
        loop.close()


def test_closing_the_loop_cancels_what_runs_and_the_next_request_starts_another() -> None:
    first = serving.serving_loop()
    started = threading.Event()
    outcome: list[BaseException] = []

    async def hang(thread: RequestThread) -> None:
        started.set()
        await asyncio.Event().wait()

    def waiting() -> None:
        try:
            first.run(hang)
        except BaseException as exc:
            outcome.append(exc)

    waiter = threading.Thread(target=waiting)
    waiter.start()
    assert started.wait(5)
    serving.close_serving_loop()
    waiter.join(5)
    assert [type(exc).__name__ for exc in outcome] == ["CancelledError"]
    assert first.closed
    assert first.loop.is_closed()
    first.close()  # closing twice is harmless
    second = serving.serving_loop()
    assert second is not first
    assert WsgiClient(to_wsgi_app(_api())).get("/where", headers=[AUTH]).status_code == 200


def test_no_loop_starts_after_interpreter_exit_closed_it(monkeypatch: pytest.MonkeyPatch) -> None:
    serving.serving_loop()
    monkeypatch.setattr(serving, "_exiting", False)
    serving._close_at_exit()
    try:
        with pytest.raises(RuntimeError, match="exiting"):
            serving.serving_loop()
        # A late request fails instead of starting a loop nothing would close;
        # the WSGI server answers it 500.
        with pytest.raises(RuntimeError, match="exiting"):
            WsgiClient(to_wsgi_app(_api())).get("/where", headers=[AUTH])
    finally:
        monkeypatch.setattr(serving, "_exiting", False)


def test_a_forked_worker_starts_its_own_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    # A real fork loses the parent's coverage data, so the fork is simulated:
    # the child sees another pid, and the at-fork hook resets the lock.
    # (gunicorn --preload is exercised for real in the smoke tests.)
    parent = serving.serving_loop()
    monkeypatch.setattr(os, "getpid", lambda: parent.pid + 1)
    serving._forget_parent_loop()
    child = serving.serving_loop()
    assert child is not parent
    assert child.pid == parent.pid + 1
    assert WsgiClient(to_wsgi_app(_api())).get("/where", headers=[AUTH]).json()["loop"] == id(
        child.loop
    )
    # The child never closes the parent's loop.
    serving.close_serving_loop()
    assert not parent.closed
    monkeypatch.undo()
    assert serving.serving_loop() is not child
    parent.close()


# --- a real threaded server -----------------------------------------------


class _ThreadingServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    request_queue_size = 128


class _QuietHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - the stdlib's name
        pass


@pytest.fixture
def served() -> Iterator[str]:
    """`to_wsgi_app` behind a threaded HTTP server on a real socket."""

    server = make_server(
        "127.0.0.1",
        0,
        to_wsgi_app(_api(max_body_bytes=4096)),
        server_class=_ThreadingServer,
        handler_class=_QuietHandler,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


def test_a_threaded_server_serves_concurrent_requests(served: str) -> None:
    def post(index: int) -> httpx.Response:
        return httpx.post(
            f"{served}/echo",
            json={"index": index},
            headers={"authorization": "Bearer reader", "host": "testserver"},
        )

    with ThreadPoolExecutor(max_workers=16) as pool:
        responses = list(pool.map(post, range(48)))
    assert [response.status_code for response in responses] == [200] * 48
    assert [response.json()["input"]["index"] for response in responses] == list(range(48))
    assert responses[0].json()["client"][0] == "127.0.0.1"
    too_large = httpx.post(
        f"{served}/echo",
        content=b'{"x": "' + b"y" * 5000 + b'"}',
        headers={"authorization": "Bearer reader", "content-type": "application/json"},
    )
    assert too_large.status_code == 413


def test_a_failing_coroutine_raises_on_the_request_thread() -> None:
    loop = ServingLoop()

    async def fail(thread: RequestThread) -> None:
        raise LookupError("from the loop")

    try:
        with pytest.raises(LookupError, match="from the loop"):
            loop.run(fail)
    finally:
        loop.close()


def test_a_job_finishing_after_its_coroutine_was_cancelled_is_dropped() -> None:
    loop = ServingLoop()
    release = threading.Event()

    def slow() -> bytes:
        release.wait(5)
        return b"late"

    async def serve(thread: RequestThread) -> str:
        job = asyncio.ensure_future(thread.call(slow))
        await asyncio.sleep(0)
        job.cancel()
        release.set()
        with contextlib.suppress(asyncio.CancelledError):
            await job
        # Let the late result reach the loop and find its future done.
        await asyncio.sleep(0.05)
        return "dropped"

    try:
        assert loop.run(serve) == "dropped"
    finally:
        loop.close()
