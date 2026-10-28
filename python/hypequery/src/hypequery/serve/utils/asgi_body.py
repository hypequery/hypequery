"""An ASGI request body, read lazily, and the caller's disconnection.

The core reads a request body at most once, and only for a route that takes
input, after authentication. `AsgiBody.chunks` hands it the `http.request`
messages as they arrive. Once the core no longer needs the body, which is
whenever it first waits for the caller to go, a listener takes over `receive`
and sets an event on `http.disconnect`, so a query whose caller has gone is
cancelled without polling the transport.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, MutableMapping
from typing import Any, Literal

Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]


class ClientDisconnectedError(Exception):
    """The caller went away before its request body arrived."""


class AsgiBody:
    """One request's `receive`, shared by the body read and the disconnect listener."""

    __slots__ = ("_gone", "_listener", "_receive", "_state")

    def __init__(self, receive: Receive) -> None:
        self._receive = receive
        self._state: Literal["unread", "reading", "read", "released"] = "unread"
        self._gone = asyncio.Event()
        self._listener: asyncio.Task[None] | None = None

    async def chunks(self) -> AsyncIterator[bytes]:
        """The body's bytes, in the order they arrive. It can be read once."""

        if self._state != "unread":
            raise RuntimeError("the request body has already been consumed")
        self._state = "reading"
        while True:
            message = await self._receive()
            if message["type"] == "http.disconnect":
                self._gone.set()
                self._state = "read"
                raise ClientDisconnectedError
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            if not message.get("more_body", False):
                self._state = "read"
                if chunk:
                    yield chunk
                return
            if chunk:
                yield chunk

    @property
    def disconnected(self) -> bool:
        """Whether the caller is known to have gone."""

        return self._gone.is_set()

    async def wait_disconnected(self) -> None:
        """Return once the caller has gone; never polls the transport."""

        if self._listener is None and self._state != "reading" and not self._gone.is_set():
            # The core waits only once it is done with the body, so whatever
            # body remains unread is the caller's to discard, not the core's.
            # While the body is being read, its own receive sees a disconnect.
            self._state = "released"
            self._listener = asyncio.create_task(self._listen())
        await self._gone.wait()

    async def _listen(self) -> None:
        while True:
            message = await self._receive()
            if message["type"] == "http.disconnect":
                self._gone.set()
                return

    async def close(self) -> None:
        """Stop listening, once the response has been sent."""

        listener, self._listener = self._listener, None
        if listener is not None:
            listener.cancel()
            # Collects the listener's outcome, a failed receive included,
            # while a cancellation of this task still propagates.
            await asyncio.gather(listener, return_exceptions=True)
