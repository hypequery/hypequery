"""A remote JSON Web Key Set, cached as jose's `createRemoteJWKSet` caches it.

- A key set is fetched on first use and kept for `cache_max_age`; a stale set
  is refetched before it is used again.
- A token whose key is not in the set refetches it, at most once per
  `cooldown` since the last successful fetch, so tokens with made-up `kid`s
  cannot make the server hammer the provider.
- Concurrent requests share one fetch, across threads and event loops.
- The fetch runs on its own thread, never on the event loop, one at a time;
  a fetch past its deadline is abandoned for a fresh one.
  It ends by `timeout`, however slowly the provider answers, is bounded by a
  response size limit, and follows no redirects. It goes through the proxy
  `urlopen` would use (`HTTPS_PROXY`, `NO_PROXY`), never for a loopback host.

A failed fetch raises `JwksUnavailable`. The authenticator lets it escape, so
the request is answered 503 (authentication unavailable), not 401: the token
was never judged.
"""

from __future__ import annotations

import asyncio
import http.client
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import Future
from typing import Any
from urllib.parse import urlsplit

from .utils.http_deadline import Deadline, DeadlineHTTPHandler, DeadlineHTTPSHandler, NoRedirects
from .utils.http_proxy import with_default_ports
from .utils.json_body import parse_json
from .utils.jwt_options import LOOPBACK_HOSTS

#: A key set larger than this is refused. Providers publish a handful of keys.
MAX_JWKS_BYTES = 512 * 1024
#: Fetches past their deadline that may still hold a thread before a key set
#: stops starting new ones. Only a fetch stuck resolving the host can get here.
MAX_STUCK_FETCHES = 4
_CHUNK_BYTES = 64 * 1024


class JwksUnavailable(Exception):  # noqa: N818 - named for what it means
    """The key set could not be fetched or was not a JSON Web Key Set."""


def _monotonic() -> float:
    return time.monotonic()


def _opener(url: str, deadline: Deadline) -> urllib.request.OpenerDirector:
    # urllib chooses the proxy: HTTPS_PROXY / HTTP_PROXY, NO_PROXY (host or
    # host:port), the system settings, and a CONNECT tunnel for https, so
    # TLS and its certificate check stay end to end. A loopback host is
    # always reached directly.
    host = urlsplit(url).hostname
    proxies = {} if host in LOOPBACK_HOSTS else with_default_ports(urllib.request.getproxies())
    return urllib.request.build_opener(
        urllib.request.ProxyHandler(proxies),
        DeadlineHTTPHandler(deadline),
        DeadlineHTTPSHandler(deadline),
        NoRedirects,
    )


def fetch_jwks(url: str, timeout: float, max_bytes: int = MAX_JWKS_BYTES) -> list[dict[str, Any]]:
    """The keys of the key set at *url*. Blocking; run it off the event loop.

    The whole fetch, from connecting to the last byte, ends by *timeout*,
    however slowly the server or a proxy answers. Redirects are not followed,
    as jose follows none.
    """

    deadline = Deadline(timeout)
    # The scheme was checked to be http or https when the URL was configured.
    request = urllib.request.Request(  # noqa: S310
        url, headers={"Accept": "application/json", "User-Agent": "hypequery-jwks"}
    )
    try:
        with deadline, _opener(url, deadline).open(request, timeout=timeout) as response:
            if response.status != 200:
                raise JwksUnavailable(f"the key set answered {response.status}")
            body = bytearray()
            while chunk := response.read1(_CHUNK_BYTES):
                body += chunk
                if len(body) > max_bytes:
                    raise JwksUnavailable("the key set is too large")
    except JwksUnavailable:
        raise
    except urllib.error.HTTPError as exc:
        exc.close()  # its response holds the socket
        raise JwksUnavailable(f"the key set answered {exc.code}") from None
    except (OSError, ValueError, http.client.HTTPException) as exc:
        # Timeouts and refused connections are OSErrors; a body cut short is
        # an HTTPException.
        if deadline.expired or isinstance(exc, TimeoutError):
            raise JwksUnavailable("the key set took too long to fetch") from exc
        raise JwksUnavailable("the key set could not be fetched") from exc
    if deadline.expired:
        raise JwksUnavailable("the key set took too long to fetch")
    try:
        document = parse_json(bytes(body))
    except (ValueError, RecursionError) as exc:
        raise JwksUnavailable("the key set is not JSON") from exc
    keys = document.get("keys") if type(document) is dict else None
    if type(keys) is not list or any(type(key) is not dict for key in keys):
        raise JwksUnavailable("the document is not a JSON Web Key Set")
    return keys


class RemoteJwks:
    """The key set at one URL, shared by every request one strategy verifies."""

    __slots__ = (
        "_cache_max_age",
        "_cooldown",
        "_fetched_at",
        "_fetching",
        "_generation",
        "_keys",
        "_keys_generation",
        "_lock",
        "_pending",
        "_pending_deadline",
        "_timeout",
        "url",
    )

    def __init__(self, url: str, *, timeout: float, cache_max_age: float, cooldown: float) -> None:
        self.url = url
        self._timeout = timeout
        self._cache_max_age = cache_max_age
        self._cooldown = cooldown
        self._lock = threading.Lock()
        self._keys: list[dict[str, Any]] | None = None
        self._fetched_at = 0.0
        self._pending: Future[list[dict[str, Any]]] | None = None
        self._pending_deadline = 0.0
        self._fetching = 0
        #: Each fetch's number, in the order they started, and the number of
        #: the fetch whose keys are cached.
        self._generation = 0
        self._keys_generation = 0

    async def keys(self) -> list[dict[str, Any]]:
        """The cached keys, fetched first when there are none or they are stale."""

        with self._lock:
            keys = self._keys
            fresh = keys is not None and _monotonic() < self._fetched_at + self._cache_max_age
        if keys is not None and fresh:
            return keys
        return await self.reload()

    def cooling_down(self) -> bool:
        """Whether the last successful fetch was too recent to fetch again."""

        with self._lock:
            return self._keys is not None and _monotonic() < self._fetched_at + self._cooldown

    async def reload(self) -> list[dict[str, Any]]:
        """Fetch the key set, joining a fetch already in flight.

        A request waits no longer than the fetch it joined has left before
        its deadline. The fetch ends itself by then; this bounds the wait
        even where nothing can end it (name resolution blocks unbounded).
        """

        pending, deadline = self._start()
        try:
            return await asyncio.wait_for(
                asyncio.wrap_future(pending), max(0.0, deadline - _monotonic())
            )
        except TimeoutError:
            raise JwksUnavailable("the key set took too long to fetch") from None

    def _start(self) -> tuple[Future[list[dict[str, Any]]], float]:
        with self._lock:
            now = _monotonic()
            # One fetch at a time: every request joins the one in flight, so
            # a slow provider costs one thread, never one per request.
            if self._pending is not None and now < self._pending_deadline:
                return self._pending, self._pending_deadline
            # A fetch past its deadline is abandoned and a fresh one starts,
            # but only while few are stuck: each holds a thread.
            if self._fetching >= MAX_STUCK_FETCHES:
                raise JwksUnavailable("earlier key-set fetches have not ended")
            pending: Future[list[dict[str, Any]]] = Future()
            # A running future cannot be cancelled, so one waiter giving up
            # (its client disconnected) does not cancel the fetch for the rest.
            pending.set_running_or_notify_cancel()
            self._pending = pending
            self._pending_deadline = now + self._timeout
            self._fetching += 1
            self._generation += 1
            generation = self._generation
        threading.Thread(
            target=self._fetch, args=(pending, generation), name="hypequery-jwks", daemon=True
        ).start()
        return pending, now + self._timeout

    def _fetch(self, pending: Future[list[dict[str, Any]]], generation: int) -> None:
        try:
            keys = fetch_jwks(self.url, self._timeout)
        except BaseException as exc:
            self._finished(pending, generation, None)
            pending.set_exception(exc)
            return
        self._finished(pending, generation, keys)
        pending.set_result(keys)

    def _finished(
        self,
        pending: Future[list[dict[str, Any]]],
        generation: int,
        keys: list[dict[str, Any]] | None,
    ) -> None:
        with self._lock:
            self._fetching -= 1
            current = self._pending is pending
            if current:
                self._pending = None
            # Only the fetch in flight updates the cache, and never with keys
            # older than those cached. An abandoned fetch finishing late may
            # carry the set from before a rotation; storing it would refuse
            # tokens signed with the new key, and restart the cooldown that
            # would let the cache recover. Its own waiters still get its keys.
            if keys is not None and current and generation > self._keys_generation:
                self._keys = keys
                self._keys_generation = generation
                self._fetched_at = _monotonic()
