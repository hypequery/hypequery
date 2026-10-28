"""A remote JSON Web Key Set, cached as jose's `createRemoteJWKSet` caches it.

- A key set is fetched on first use and kept for `cache_max_age`; a stale set
  is refetched before it is used again.
- A token whose key is not in the set refetches it, at most once per
  `cooldown` since the last successful fetch, so tokens with made-up `kid`s
  cannot make the server hammer the provider.
- Concurrent requests share one fetch, across threads and event loops.
- The fetch runs on its own thread, never on the event loop, and is bounded by
  `timeout` and a response size limit. It follows no redirects.

A failed fetch raises `JwksUnavailable`. The authenticator lets it escape, so
the request is answered 503 (authentication unavailable), not 401: the token
was never judged.
"""

from __future__ import annotations

import asyncio
import http.client
import threading
import time
import urllib.request
from concurrent.futures import Future
from typing import Any

from .utils.json_body import parse_json

#: A key set larger than this is refused. Providers publish a handful of keys.
MAX_JWKS_BYTES = 512 * 1024


class JwksUnavailable(Exception):  # noqa: N818 - named for what it means
    """The key set could not be fetched or was not a JSON Web Key Set."""


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        # Returning None makes urllib raise the 3xx as an HTTPError: a key
        # set is fetched from exactly the configured URL, as jose does.
        return None


def _monotonic() -> float:
    return time.monotonic()


def fetch_jwks(url: str, timeout: float, max_bytes: int = MAX_JWKS_BYTES) -> list[dict[str, Any]]:
    """The keys of the key set at *url*. Blocking; run it off the event loop."""

    deadline = _monotonic() + timeout
    opener = urllib.request.build_opener(_NoRedirects)
    # The URL's scheme was checked to be http or https when it was configured.
    request = urllib.request.Request(  # noqa: S310
        url, headers={"Accept": "application/json", "User-Agent": "hypequery-jwks"}
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                raise JwksUnavailable(f"the key set answered {response.status}")
            body = bytearray()
            while chunk := response.read(64 * 1024):
                body += chunk
                if len(body) > max_bytes:
                    raise JwksUnavailable("the key set is too large")
                if _monotonic() > deadline:
                    raise JwksUnavailable("the key set took too long to read")
    except JwksUnavailable:
        raise
    except (OSError, ValueError, http.client.HTTPException) as exc:
        # URLError, HTTPError and timeouts are OSErrors; a truncated body is
        # an HTTPException.
        raise JwksUnavailable("the key set could not be fetched") from exc
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
        "_keys",
        "_lock",
        "_pending",
        "_pending_since",
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
        self._pending_since = 0.0

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
        """Fetch the key set, joining a fetch already in flight."""

        pending = self._start()
        try:
            # The fetch bounds itself; this bounds the wait too, so a fetch
            # stuck where no socket timeout reaches (name resolution) cannot
            # hold the request.
            return await asyncio.wait_for(asyncio.wrap_future(pending), self._timeout * 2)
        except TimeoutError:
            raise JwksUnavailable("the key set took too long to fetch") from None

    def _start(self) -> Future[list[dict[str, Any]]]:
        with self._lock:
            now = _monotonic()
            pending = self._pending
            if pending is not None and now - self._pending_since <= self._timeout * 2:
                return pending
            # Abandon a fetch that should have finished long ago.
            pending = Future()
            # A running future cannot be cancelled, so one waiter giving up
            # (its client disconnected) does not cancel the fetch for the rest.
            pending.set_running_or_notify_cancel()
            self._pending = pending
            self._pending_since = now
        threading.Thread(
            target=self._fetch, args=(pending,), name="hypequery-jwks", daemon=True
        ).start()
        return pending

    def _fetch(self, pending: Future[list[dict[str, Any]]]) -> None:
        try:
            keys = fetch_jwks(self.url, self._timeout)
        except BaseException as exc:
            with self._lock:
                if self._pending is pending:
                    self._pending = None
            pending.set_exception(exc)
            return
        with self._lock:
            if self._pending is pending:
                self._pending = None
                self._keys = keys
                self._fetched_at = _monotonic()
        pending.set_result(keys)
