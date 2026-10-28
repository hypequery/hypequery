"""The core's request and response, independent of any web framework.

A `ServeRequest` carries what the pipeline needs and nothing it would have to
trust blindly: header names are lowercased once, every header and query value
is kept (so a repeated credential or `Content-Length` can be refused rather
than silently resolved), and the body is read only when a route needs it,
through the core's body policy.
"""

from __future__ import annotations

from collections.abc import AsyncIterable, Awaitable, Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from .utils.json_body import render_json

#: The request body: bytes the adapter already holds, or chunks it streams.
#: The core reads either at most once, bounded by the body policy.
Body = bytes | AsyncIterable[bytes]
#: Runs a blocking callable on the thread a sync host serves the request on.
RequestThreadRunner = Callable[[Callable[[], Any]], Awaitable[Any]]


class _MultiValues:
    """An immutable multi-valued mapping, in the order the values arrived."""

    __slots__ = ("_items",)

    def __init__(self, items: Iterable[tuple[str, str]] = ()) -> None:
        self._items = tuple((self._key(name), value) for name, value in items)

    @staticmethod
    def _key(name: str) -> str:
        return name

    def get(self, name: str, default: str | None = None) -> str | None:
        """The first value for *name*, or *default*."""

        key = self._key(name)
        for item, value in self._items:
            if item == key:
                return value
        return default

    def getlist(self, name: str) -> list[str]:
        key = self._key(name)
        return [value for item, value in self._items if item == key]

    def items(self) -> tuple[tuple[str, str], ...]:
        return self._items

    def __contains__(self, name: object) -> bool:
        return type(name) is str and any(item == self._key(name) for item, _ in self._items)

    def __iter__(self) -> Iterator[str]:
        return iter(dict.fromkeys(item for item, _ in self._items))

    def __len__(self) -> int:
        return len(self._items)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({list(self._items)!r})"


class Headers(_MultiValues):
    """Request headers with lowercase names. Values are never redacted here."""

    __slots__ = ()

    @staticmethod
    def _key(name: str) -> str:
        return name.lower()

    def __repr__(self) -> str:
        # Header values include credentials and cookies.
        return f"Headers({sorted(set(self))!r})"


class QueryParams(_MultiValues):
    """Query-string parameters, names compared exactly."""

    __slots__ = ()


@dataclass(frozen=True, slots=True, eq=False)
class ServeRequest:
    """One HTTP request, as an adapter presents it to the core.

    *path* is the URL path as sent, percent-encoding intact, like TypeScript's
    `URL.pathname`. *client* is the transport peer, after any proxy handling
    the host already applied. *raw* is the framework's own request, for the
    host's code; the core never reads it. *wait_disconnected*, when given,
    returns once the caller has gone, and the core cancels the query it was
    running for them; it is only awaited after the body has been read.

    *run_on_request_thread* is set by a sync host (WSGI, a Django or Flask
    sync view): it runs a blocking callable on the thread the host serves the
    request on, while the core waits on its loop. Host code that reads the
    host's per-thread state, such as a Django user loaded through the ORM or a
    Flask-Login user from a thread-local database session, runs there. It is
    None under an async host, whose request has no thread of its own.
    """

    method: str
    path: str
    query: QueryParams = field(default_factory=QueryParams)
    headers: Headers = field(default_factory=Headers)
    body: Body = b""
    client: tuple[str, int] | None = None
    raw: object = None
    wait_disconnected: Callable[[], Awaitable[None]] | None = None
    run_on_request_thread: RequestThreadRunner | None = None

    def __post_init__(self) -> None:
        if type(self.query) is not QueryParams or type(self.headers) is not Headers:
            raise TypeError("ServeRequest takes QueryParams and Headers")


@dataclass(frozen=True, slots=True)
class ServeResponse:
    """A status, lowercase headers, and the encoded body."""

    status: int
    headers: Mapping[str, str] = field(default_factory=dict)
    body: bytes = b""

    @classmethod
    def json(
        cls, value: object, *, status: int = 200, headers: Mapping[str, str] | None = None
    ) -> ServeResponse:
        """A JSON response; *value* is rendered here, once, for every adapter."""

        return cls.encoded(render_json(value), status=status, headers=headers)

    @classmethod
    def encoded(
        cls, body: bytes, *, status: int = 200, headers: Mapping[str, str] | None = None
    ) -> ServeResponse:
        """A response whose body is already JSON bytes."""

        merged = {name.lower(): value for name, value in (headers or {}).items()}
        merged["content-type"] = "application/json"
        return cls(status=status, headers=merged, body=body)

    def with_headers(self, headers: Mapping[str, str]) -> ServeResponse:
        """This response with *headers* set, replacing any of the same name."""

        merged = dict(self.headers)
        merged.update({name.lower(): value for name, value in headers.items()})
        return ServeResponse(status=self.status, headers=merged, body=self.body)

    def without_headers(self, *names: str) -> ServeResponse:
        drop = {name.lower() for name in names}
        kept = {name: value for name, value in self.headers.items() if name not in drop}
        return ServeResponse(status=self.status, headers=kept, body=self.body)
