"""Route one URL prefix of an ASGI host application to another ASGI app.

The mounted app sees the scope the way Starlette's own ``Mount`` passes it: the
full ``path`` and the prefix appended to ``root_path``, so its routes and
generated URLs both resolve under the prefix.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any, Literal, TypeAlias

Scope: TypeAlias = MutableMapping[str, Any]
Receive: TypeAlias = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send: TypeAlias = Callable[[MutableMapping[str, Any]], Awaitable[None]]
ASGIApp: TypeAlias = Callable[[Scope, Receive, Send], Awaitable[None]]


def validate_prefix(prefix: str) -> str:
    """A mount prefix: ``/name`` or ``/a/b``, without a trailing slash."""

    if (
        type(prefix) is not str
        or not prefix.startswith("/")
        or prefix.endswith("/")
        or "//" in prefix
        or any(character in prefix for character in "?#")
    ):
        raise ValueError(
            "a mount prefix starts with '/' and has no trailing slash, e.g. '/analytics'"
        )
    return prefix


def under_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def _route_path(scope: Scope) -> str:
    # Servers differ on whether ``path`` includes ``root_path``; read it the way
    # Starlette does.
    path: str = scope.get("path", "")
    root: str = scope.get("root_path", "")
    return path[len(root) :] if root and path.startswith(root) else path


def mount_asgi(
    host: ASGIApp,
    mounted: ASGIApp,
    *,
    prefix: str,
    lifespan: Literal["host", "mounted"] = "host",
) -> ASGIApp:
    """*host*, except that requests under *prefix* go to *mounted*.

    *lifespan* chooses which app receives the server's startup and shutdown
    events; one event stream cannot be shared. Pass ``mounted`` for a host such
    as Django that refuses lifespan.
    """

    prefix = validate_prefix(prefix)
    if lifespan not in ("host", "mounted"):
        raise ValueError("lifespan must be 'host' or 'mounted'")

    async def application(scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope.get("type")
        if kind == "lifespan":
            target = host if lifespan == "host" else mounted
            await target(scope, receive, send)
            return
        route_path = _route_path(scope)
        if kind in ("http", "websocket") and under_prefix(route_path, prefix):
            root: str = scope.get("root_path", "")
            child = dict(scope)
            child["root_path"] = root + prefix
            child["path"] = root + route_path
            await mounted(child, receive, send)
            return
        await host(scope, receive, send)

    return application
