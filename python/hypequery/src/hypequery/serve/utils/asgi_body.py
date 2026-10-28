"""An ASGI request body, read lazily, and the caller's disconnection.

The core reads a request body at most once, and only for a route that takes
input, after authentication. `AsgiBody.chunks` hands it the `http.request`
messages as they arrive. Once the core no longer needs the body, which is
whenever it first asks whether the caller is still there, a listener takes
over `receive` and records `http.disconnect`, so a query whose caller has gone
is cancelled without polling the transport.
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

    __slots__ = ("_disconnected", "_listener", "_receive", "_state")

    def __init__(self, receive: Receive) -> None:
        self._receive = receive
        self._state: Literal["unread", "reading", "read", "released"] = "unread"
        self._disconnected = False
        self._listener: asyncio.Task[None] | None = None

    async def chunks(self) -> AsyncIterator[bytes]:
        """The body's bytes, in the order they arrive. It can be read once."""

        if self._state != "unread":
            raise RuntimeError("the request body has already been consumed")
        self._state = "reading"
        while True:
            message = await self._receive()
            if message["type"] == "http.disconnect":
                self._disconnected = True
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

    async def is_disconnected(self) -> bool:
        """Whether the caller has gone. Never waits on the transport."""

        if self._disconnected:
            return True
        if self._state == "reading":
            # The body is being read: its own receive will see a disconnect.
            return False
        if self._listener is None:
            # The core asks only once it is done with the body, so whatever
            # body remains unread is the caller's to discard, not the core's.
            self._state = "released"
            self._listener = asyncio.create_task(self._listen())
        return self._disconnected

    async def _listen(self) -> None:
        while True:
            message = await self._receive()
            if message["type"] == "http.disconnect":
                self._disconnected = True
                return

    async def close(self) -> None:
        """Stop listening, once the response has been sent."""

        listener, self._listener = self._listener, None
        if listener is not None:
            listener.cancel()
            # Collects the listener's outcome, a failed receive included,
            # while a cancellation of this task still propagates.
            await asyncio.gather(listener, return_exceptions=True)
