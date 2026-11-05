"""DNS-rebinding protection for the self-hosted HTTP transport.

A browser tricked into resolving an attacker's name to a loopback or private
address still sends the attacker's name as ``Host``, and a page script sends
its own ``Origin``. Both are checked before anything else, as in TypeScript's
`utils/http-server/guards.ts`.
"""

from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urlsplit

#: Loopback names allowed when no explicit host list is configured.
DEFAULT_ALLOWED_HOSTS: tuple[str, ...] = ("localhost", "127.0.0.1", "[::1]")


def host_name(value: str) -> str:
    """The host name of a ``Host`` header value, lower-cased and without its port."""

    host = value.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host if end == -1 else host[: end + 1]
    return host.split(":", 1)[0]


def normalize_allowed_hosts(hosts: Iterable[str] | None) -> frozenset[str]:
    values = tuple(DEFAULT_ALLOWED_HOSTS if hosts is None else hosts)
    normalized: set[str] = set()
    for host in values:
        if not isinstance(host, str) or not host.strip():
            raise ValueError("allowed_hosts entries must be non-empty host names")
        normalized.add(host_name(host))
    if not normalized:
        raise ValueError("allowed_hosts must name at least one host")
    return frozenset(normalized)


def normalize_allowed_origins(origins: Iterable[str] | None) -> frozenset[str]:
    normalized: set[str] = set()
    for origin in origins or ():
        parts = urlsplit(origin) if isinstance(origin, str) else None
        if (
            parts is None
            or parts.scheme not in ("http", "https")
            or not parts.netloc
            or parts.path not in ("", "/")
            or parts.query
            or parts.fragment
            or "@" in parts.netloc
        ):
            raise ValueError(
                "allowed_origins entries must be bare origins such as https://app.example.com: "
                f"{origin!r}"
            )
        normalized.add(f"{parts.scheme}://{parts.netloc.lower()}")
    return frozenset(normalized)


def host_allowed(host: str | None, allowed: frozenset[str]) -> bool:
    return bool(host) and host_name(host or "") in allowed


def origin_allowed(origin: str | None, allowed: frozenset[str]) -> bool:
    """A request without ``Origin`` is an ordinary MCP client; one with it must be listed."""

    return origin is None or origin in allowed
