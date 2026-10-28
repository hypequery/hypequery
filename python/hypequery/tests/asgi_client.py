"""A synchronous test client for any ASGI application, built on httpx alone.

`AsgiClient` speaks the slice of Starlette's `TestClient` interface the suite
uses, without Starlette: requests go through `httpx.ASGITransport` on one
event loop that runs in a background thread for the whole test session, so
state that outlives a request (admission slots, draining work, rate-limit
windows) behaves as under a server. Like `TestClient`, it sends
`Host: testserver` from the peer `testclient:50000` unless told otherwise.
Used as a context manager, it runs the application's `lifespan`.
"""

from __future__ import annotations

import asyncio
import inspect
import threading
from collections.abc import Callable, Coroutine, Mapping, MutableMapping
from types import TracebackType
from typing import Any, TypeVar

import httpx

_T = TypeVar("_T")
_Message = MutableMapping[str, Any]

_LOOP: asyncio.AbstractEventLoop | None = None
_LOCK = threading.Lock()


def _loop() -> asyncio.AbstractEventLoop:
    """The session's serving loop, started on first use."""

    global _LOOP
    with _LOCK:
        if _LOOP is None:
            _LOOP = asyncio.new_event_loop()
            threading.Thread(target=_LOOP.run_forever, name="asgi-client", daemon=True).start()
        return _LOOP


def run(coroutine: Coroutine[Any, Any, _T]) -> _T:
    """Run *coroutine* on the serving loop and wait for its result."""

    return asyncio.run_coroutine_threadsafe(coroutine, _loop()).result()


class AsgiClient:
    def __init__(
        self,
        app: Any,
        *,
        client: tuple[str, int] = ("testclient", 50000),
        base_url: str = "http://testserver",
        root_path: str = "",
        raise_server_exceptions: bool = True,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.app = app
        self._headers = dict(headers or {})
        self._transport = httpx.ASGITransport(
            app=app,
            client=client,
            root_path=root_path,
            raise_app_exceptions=raise_server_exceptions,
        )
        self._base_url = base_url
        self._lifespan: tuple[asyncio.Queue[_Message], asyncio.Queue[_Message]] | None = None
        self._lifespan_task: asyncio.Task[None] | None = None

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async with httpx.AsyncClient(
            transport=self._transport, base_url=self._base_url, headers=self._headers
        ) as http:
            return await http.request(method, url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return run(self._request(method, url, **kwargs))

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("DELETE", url, **kwargs)

    def options(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("OPTIONS", url, **kwargs)

    def head(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("HEAD", url, **kwargs)

    def call(self, function: Callable[..., Any], *args: Any) -> Any:
        """Call *function* on the serving loop, awaiting what it returns if awaitable."""

        async def invoke() -> Any:
            result = function(*args)
            return await result if inspect.isawaitable(result) else result

        return run(invoke())

    def __enter__(self) -> AsgiClient:
        run(self._startup())
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        run(self._shutdown())

    async def _startup(self) -> None:
        received: asyncio.Queue[_Message] = asyncio.Queue()
        sent: asyncio.Queue[_Message] = asyncio.Queue()
        self._lifespan = (received, sent)

        async def send(message: _Message) -> None:
            await sent.put(message)

        self._lifespan_task = asyncio.ensure_future(
            self.app({"type": "lifespan", "asgi": {"version": "3.0"}}, received.get, send)
        )
        await received.put({"type": "lifespan.startup"})
        message = await self._answer(sent)
        if message["type"] != "lifespan.startup.complete":
            raise RuntimeError(message.get("message", "lifespan startup failed"))

    async def _answer(self, sent: asyncio.Queue[_Message]) -> _Message:
        """The app's next lifespan message, or a failure if it returned without one."""

        assert self._lifespan_task is not None
        answer = asyncio.ensure_future(sent.get())
        await asyncio.wait({answer, self._lifespan_task}, return_when=asyncio.FIRST_COMPLETED)
        if answer.done():
            return answer.result()
        answer.cancel()
        self._lifespan_task.result()  # re-raise what ended the app, if anything
        raise RuntimeError("the app returned without answering its lifespan")

    async def _shutdown(self) -> None:
        if self._lifespan is None or self._lifespan_task is None:
            return
        received, sent = self._lifespan
        self._lifespan = None
        await received.put({"type": "lifespan.shutdown"})
        message = await self._answer(sent)
        await self._lifespan_task
        if message["type"] != "lifespan.shutdown.complete":
            raise RuntimeError(message.get("message", "lifespan shutdown failed"))
