"""What an ASGI `http` scope says about a request, in the core's terms."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl

from ..core.messages import Headers, QueryParams


def scope_headers(scope: Mapping[str, Any]) -> Headers:
    """The request headers, every value kept, decoded as latin-1."""

    return Headers(
        (name.decode("latin-1"), value.decode("latin-1")) for name, value in scope["headers"]
    )


def scope_query(scope: Mapping[str, Any]) -> QueryParams:
    query: bytes | str = scope.get("query_string", b"")
    # Django's AsyncClient builds its scope with a str here.
    text = query.decode("latin-1") if isinstance(query, bytes) else query
    return QueryParams(parse_qsl(text, keep_blank_values=True))


def scope_client(scope: Mapping[str, Any]) -> tuple[str, int] | None:
    client = scope.get("client")
    return (str(client[0]), int(client[1])) if client else None


def raw_scope_path(scope: Mapping[str, Any]) -> str | None:
    """The full path as the client sent it, when the server gives it."""

    raw = scope.get("raw_path")
    return raw.decode("latin-1") if isinstance(raw, bytes) else None


def route_path(scope: Mapping[str, Any]) -> str:
    """The request path below the app's mount point, percent-encoding intact.

    The core matches the path as sent, like TypeScript's `URL.pathname`, so
    this is the raw path when the server gives one. A mounted app's scope
    names the mount in `root_path`, which is stripped; when the raw path does
    not start with it, the decoded path is used instead.
    """

    path: str = raw_scope_path(scope) or scope["path"]
    root: str = scope.get("root_path") or ""
    if not root:
        return path
    for candidate in (path, scope["path"]):
        if candidate == root:
            return "/"
        if candidate.startswith(root) and candidate[len(root)] == "/":
            return candidate[len(root) :]
    return path
