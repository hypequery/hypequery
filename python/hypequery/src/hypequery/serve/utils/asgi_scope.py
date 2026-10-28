"""The path an ASGI request names, as the core matches it."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def route_path(scope: Mapping[str, Any]) -> str:
    """The request path below the app's mount point, percent-encoding intact.

    The core matches the path as sent, like TypeScript's `URL.pathname`, so
    this is the raw path when the server gives one. A mounted app's scope
    names the mount in `root_path`, which is stripped; when the raw path does
    not start with it, the decoded path is used instead.
    """

    raw = scope.get("raw_path")
    path: str = raw.decode("latin-1") if isinstance(raw, bytes) else scope["path"]
    root: str = scope.get("root_path") or ""
    if not root:
        return path
    for candidate in (path, scope["path"]):
        if candidate == root:
            return "/"
        if candidate.startswith(root) and candidate[len(root)] == "/":
            return candidate[len(root) :]
    return path
