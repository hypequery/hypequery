"""The pure-ASGI adapter: request bodies, disconnects, lifespan and the wire."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, MutableMapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import pytest
from pydantic import TypeAdapter

from hypequery.datasets import (
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    create_async_dataset_client,
    dimension,
    measure,
)
from hypequery.serve import (
    Api,
    AsgiApp,
    Call,
    Credential,
    Principal,
    ServeRequest,
    ServeResponse,
    add_dataset_endpoint,
    create_api,
    to_asgi_app,
)
from hypequery.serve.utils.asgi_body import AsgiBody, ClientDisconnectedError
from hypequery.serve.utils.asgi_scope import route_path

Message = MutableMapping[str, Any]
AUTH = (b"authorization", b"Bearer reader")


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


def _scope(path: str = "/echo", method: str = "POST", **extra: Any) -> dict[str, Any]:
    headers = [(b"host", b"testserver"), AUTH, (b"content-type", b"application/json")]
    return {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers + extra.pop("headers", []),
        "client": ("203.0.113.9", 5000),
        **extra,
    }


@dataclass
class Exchange:
    """What an app sent, and how many messages it received."""

    sent: list[Message]
    received: int

    @property
    def status(self) -> int:
        return int(self.sent[0]["status"])

    @property
    def headers(self) -> dict[bytes, bytes]:
        return dict(self.sent[0]["headers"])

    @property
    def body(self) -> bytes:
        return b"".join(m.get("body", b"") for m in self.sent if m["type"] == "http.response.body")


def _exchange(app: AsgiApp, scope: dict[str, Any], messages: list[Message]) -> Exchange:
    sent: list[Message] = []
    received = 0

    async def run() -> None:
        done = asyncio.Event()

        async def receive() -> Message:
            nonlocal received
            received += 1
            if messages:
                return messages.pop(0)
            await done.wait()
            return {"type": "http.disconnect"}

        async def send(message: Message) -> None:
            sent.append(message)
            if message["type"] == "http.response.body":
                done.set()

        await app(scope, receive, send)

    asyncio.run(run())
    return Exchange(sent, received)


def _echo_app(**options: Any) -> AsgiApp:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({"input": call.input, "query": call.request.query.items()})

    api = create_api(auth=_authenticate, **options)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    return to_asgi_app(api)


def _request(body: bytes, *, more: bool = False) -> Message:
    return {"type": "http.request", "body": body, "more_body": more}


# --- bodies ---------------------------------------------------------------


def test_a_body_in_several_messages_is_read_lazily_and_whole() -> None:
    exchange = _exchange(
        _echo_app(),
        _scope(query_string=b"a=1&a=2&b="),
        [_request(b'{"x"', more=True), _request(b"", more=True), _request(b": 1}")],
    )
    assert exchange.status == 200
    assert exchange.body == b'{"input":{"x":1},"query":[["a","1"],["a","2"],["b",""]]}'
    assert exchange.headers[b"content-length"] == str(len(exchange.body)).encode()


def test_a_streamed_body_stops_being_read_at_the_limit() -> None:
    chunks = [_request(b"x" * 40, more=True) for _ in range(10)]
    exchange = _exchange(_echo_app(max_body_bytes=64), _scope(), chunks)
    assert exchange.status == 413
    # Two chunks pass the limit; the rest are never received.
    assert len(chunks) == 8


def test_an_unauthenticated_body_is_never_received() -> None:
    scope = _scope()
    scope["headers"] = [header for header in scope["headers"] if header != AUTH]
    messages = [_request(b"{}")]
    exchange = _exchange(_echo_app(), scope, messages)
    assert exchange.status == 401
    assert messages == [_request(b"{}")]


def test_a_caller_gone_mid_body_is_caller_input() -> None:
    exchange = _exchange(
        _echo_app(), _scope(), [_request(b"{", more=True), {"type": "http.disconnect"}]
    )
    assert exchange.status == 400
    assert b"There was an error parsing the body" in exchange.body


def test_a_bodiless_status_is_written_without_a_body() -> None:
    async def empty(call: Call) -> ServeResponse:
        return ServeResponse(status=204, headers={}, body=b"")

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/empty", empty, public=True)
    exchange = _exchange(to_asgi_app(api), _scope("/empty", "GET"), [_request(b"")])
    assert exchange.status == 204
    assert b"content-length" not in exchange.headers
    assert exchange.body == b""


def test_the_body_reader_is_read_once_and_never_after_release() -> None:
    async def run() -> None:
        messages = [_request(b"a", more=True), _request(b"b")]

        async def receive() -> Message:
            return messages.pop(0) if messages else {"type": "http.disconnect"}

        body = AsgiBody(receive)
        reading = body.chunks()
        assert await reading.__anext__() == b"a"
        # While the core reads, the body's own receive watches for a disconnect.
        assert await body.is_disconnected() is False
        assert [chunk async for chunk in reading] == [b"b"]
        with pytest.raises(RuntimeError):
            await body.chunks().__anext__()
        await body.close()

        released = AsgiBody(receive)
        assert await released.is_disconnected() is False
        await asyncio.sleep(0)
        assert await released.is_disconnected() is True
        with pytest.raises(RuntimeError):
            await released.chunks().__anext__()
        await released.close()

        async def gone() -> Message:
            return {"type": "http.disconnect"}

        with pytest.raises(ClientDisconnectedError):
            await AsgiBody(gone).chunks().__anext__()

    asyncio.run(run())


# --- disconnects cancel the query -----------------------------------------


def test_a_caller_that_disconnects_cancels_its_query() -> None:
    seen: list[CompiledQuery] = []

    @dataclass(frozen=True)
    class Rows:
        columns: tuple[str, ...] = ("rows",)
        rows: tuple[tuple[int, ...], ...] = ((1,),)

    class WaitingExecutor:
        async def execute(self, compiled: CompiledQuery) -> Rows:
            seen.append(compiled)
            assert compiled.cancellation is not None
            while not compiled.cancellation.is_set():
                await asyncio.sleep(0.01)
            raise CompiledQueryError("aborted", "The request was cancelled.")

    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"id": dimension.number()},
        measures={"rows": measure.count("id")},
    )
    api = create_api(auth=_authenticate)
    add_dataset_endpoint(
        api,
        "/query",
        dataset=dataset,
        client=create_async_dataset_client(executor=WaitingExecutor()),
    )
    app = to_asgi_app(api)
    sent: list[Message] = []

    async def run() -> None:
        messages = [_request(b'{"measures": ["rows"]}')]

        async def receive() -> Message:
            if messages:
                return messages.pop(0)
            # The caller leaves once its query has started.
            while not seen:
                await asyncio.sleep(0.01)
            return {"type": "http.disconnect"}

        async def send(message: Message) -> None:
            sent.append(message)

        await asyncio.wait_for(app(_scope("/query"), receive, send), 5)

    asyncio.run(run())
    assert seen[0].cancellation is not None
    assert seen[0].cancellation.is_set()
    assert sent[0]["status"] == 503
    assert b"The request was cancelled." in sent[1]["body"]


# --- lifespan, websockets and faults --------------------------------------


def _lifespan(app: AsgiApp) -> list[Message]:
    sent: list[Message] = []

    async def run() -> None:
        messages: list[Message] = [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

        async def receive() -> Message:
            return messages.pop(0)

        async def send(message: Message) -> None:
            sent.append(message)

        await app({"type": "lifespan", "asgi": {"version": "3.0"}}, receive, send)

    asyncio.run(run())
    return sent


def test_lifespan_runs_the_context_around_the_server() -> None:
    events: list[str] = []

    @asynccontextmanager
    async def lifespan() -> AsyncIterator[None]:
        events.append("startup")
        yield
        events.append("shutdown")

    api = create_api(auth=_authenticate)
    sent = _lifespan(to_asgi_app(api, lifespan=lifespan))
    assert [message["type"] for message in sent] == [
        "lifespan.startup.complete",
        "lifespan.shutdown.complete",
    ]
    assert events == ["startup", "shutdown"]
    assert [m["type"] for m in _lifespan(to_asgi_app(api))] == [
        "lifespan.startup.complete",
        "lifespan.shutdown.complete",
    ]


@pytest.mark.parametrize("phase", ["startup", "shutdown"])
def test_a_failing_lifespan_reports_without_detail(
    phase: str, caplog: pytest.LogCaptureFixture
) -> None:
    @asynccontextmanager
    async def lifespan() -> AsyncIterator[None]:
        if phase == "startup":
            raise RuntimeError("SECRET-DSN")
        yield
        raise RuntimeError("SECRET-DSN")

    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        sent = _lifespan(to_asgi_app(create_api(auth=_authenticate), lifespan=lifespan))
    failed = sent[-1]
    assert failed["type"] == f"lifespan.{phase}.failed"
    assert "SECRET" not in failed["message"]
    assert "SECRET-DSN" in caplog.text


def test_a_websocket_is_closed_and_other_scopes_refused() -> None:
    app = to_asgi_app(create_api(auth=_authenticate))
    sent: list[Message] = []

    async def receive() -> Message:
        return {"type": "websocket.connect"}

    async def send(message: Message) -> None:
        sent.append(message)

    asyncio.run(app({"type": "websocket", "path": "/"}, receive, send))
    assert sent == [{"type": "websocket.close", "code": 1000}]
    with pytest.raises(ValueError, match="unsupported"):
        asyncio.run(app({"type": "telepathy"}, receive, send))


def test_a_fault_in_the_core_is_answered_without_detail(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    app = _echo_app()

    async def broken(request: ServeRequest, respond: Any) -> None:
        raise RuntimeError("SECRET")

    monkeypatch.setattr(app.api, "serve", broken)
    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        exchange = _exchange(app, _scope(), [_request(b"{}")])
    assert exchange.status == 500
    assert b"SECRET" not in exchange.body
    assert exchange.headers[b"cache-control"] == b"no-store"
    assert exchange.headers[b"x-request-id"].decode() in caplog.text


def test_to_asgi_app_checks_its_arguments_and_the_client_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(TypeError, match="create_api"):
        to_asgi_app(object())  # type: ignore[arg-type]
    api = create_api(auth=_authenticate)
    with pytest.raises(TypeError, match="lifespan"):
        to_asgi_app(api, lifespan="startup")  # type: ignore[arg-type]
    checked: list[Api] = []
    monkeypatch.setattr(
        "hypequery.serve.client_contract.export_client_contract", lambda api: checked.append(api)
    )
    to_asgi_app(api)
    assert checked == []
    monkeypatch.setattr(type(api.client_endpoints), "bindings", property(lambda self: (object(),)))
    to_asgi_app(api)
    assert checked == [api]


# --- paths ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("scope", "path"),
    [
        ({"path": "/a b", "raw_path": b"/a%20b"}, "/a%20b"),
        ({"path": "/a"}, "/a"),
        ({"path": "/api/x", "raw_path": b"/api/x", "root_path": "/api"}, "/x"),
        ({"path": "/api", "raw_path": b"/api", "root_path": "/api"}, "/"),
        # An older server leaves the mount out of the path itself.
        ({"path": "/x", "raw_path": b"/x", "root_path": "/api"}, "/x"),
        # The raw path spells the mount differently: the decoded path decides.
        ({"path": "/ap i/x", "raw_path": b"/ap%20i/x", "root_path": "/ap i"}, "/x"),
        ({"path": "/apix", "raw_path": b"/apix", "root_path": "/api"}, "/apix"),
    ],
)
def test_the_route_path_is_below_the_mount_and_as_sent(scope: dict[str, Any], path: str) -> None:
    assert route_path(scope) == path
