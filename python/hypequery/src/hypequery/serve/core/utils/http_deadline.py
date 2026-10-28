"""Blocking `urllib` requests that end by a deadline, however the server answers.

A socket timeout bounds each receive, not the request: a server sending one
byte just inside every timeout keeps a read alive indefinitely. A `Deadline`
holds a duplicate of every socket its requests open and, when it expires,
shuts those connections down. That ends whatever receive is blocked: in the
TLS handshake, a proxy's `CONNECT` reply, the headers or the body.

It holds duplicates because TLS takes the socket over: wrapping detaches the
original object, so shutting that one down would do nothing. A shutdown acts
on the connection, not the descriptor, so the duplicate reaches it however it
has since been wrapped, and as the Deadline owns the duplicate its descriptor
cannot be reused by an unrelated socket meanwhile.
"""

from __future__ import annotations

import http.client
import socket
import threading
import urllib.request
from contextlib import suppress
from types import TracebackType
from typing import Any


class Deadline:
    """Shuts down every connection it tracks once *timeout* seconds have passed.

    Use it as a context manager around the request; leaving it disarms the
    timer and releases the duplicates.
    """

    def __init__(self, timeout: float) -> None:
        self._lock = threading.Lock()
        self._duplicates: list[socket.socket] = []
        self.expired = False
        self._timer = threading.Timer(timeout, self._expire)
        self._timer.daemon = True

    def __enter__(self) -> Deadline:
        self._timer.start()
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._timer.cancel()
        with self._lock:
            duplicates, self._duplicates = self._duplicates, []
        for duplicate in duplicates:
            duplicate.close()

    def track(self, sock: socket.socket) -> socket.socket:
        """Track *sock*'s connection; refused once the deadline has passed."""

        with self._lock:
            if not self.expired:
                self._duplicates.append(sock.dup())
                return sock
        sock.close()
        raise TimeoutError("the deadline passed while connecting")

    def _expire(self) -> None:
        with self._lock:
            self.expired = True
            for duplicate in self._duplicates:
                with suppress(OSError):  # the connection already ended
                    duplicate.shutdown(socket.SHUT_RDWR)


def _tracked(connection_class: Any, deadline: Deadline) -> Any:
    """*connection_class*, with every socket it opens tracked by *deadline*."""

    class Tracked(connection_class):  # type: ignore[misc]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            create = socket.create_connection
            # Tracked as soon as it connects, before a proxy tunnel or TLS
            # is set up on it, so the deadline covers those too.
            self._create_connection = lambda *a, **k: deadline.track(create(*a, **k))

    return Tracked


class DeadlineHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, deadline: Deadline) -> None:
        super().__init__()
        self._deadline = deadline

    def do_open(
        self, http_class: Any, req: urllib.request.Request, **kwargs: Any
    ) -> http.client.HTTPResponse:
        return super().do_open(_tracked(http_class, self._deadline), req, **kwargs)


class DeadlineHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, deadline: Deadline) -> None:
        super().__init__()
        self._deadline = deadline

    def do_open(
        self, http_class: Any, req: urllib.request.Request, **kwargs: Any
    ) -> http.client.HTTPResponse:
        return super().do_open(_tracked(http_class, self._deadline), req, **kwargs)


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        # Returning None makes urllib raise the 3xx as an HTTPError.
        return None
