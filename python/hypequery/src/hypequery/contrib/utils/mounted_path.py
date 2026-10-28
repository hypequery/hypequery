"""Where a framework's router mounted an API, from the request it routed.

Django's URLconf and Flask's blueprints route on the decoded path and hand the
API's catch-all view the part below their prefix. The core matches the path as
the client sent it, like every other adapter, and names client-contract paths
under the prefix the request was actually routed through.
"""

from __future__ import annotations

from dataclasses import dataclass

from ...serve.utils.wsgi_environ import path_below


@dataclass(frozen=True, slots=True)
class MountedPath:
    #: The path the core matches: below the prefix, percent-encoding intact when known.
    path: str
    #: The decoded prefix the router served the request under, without a trailing '/'.
    mounted_at: str


def mounted_path(public: str, below: str, raw: str | None) -> MountedPath:
    """Split a routed request's path at its router's prefix.

    *public* is the decoded path the framework routed, its script root
    included; *below* is the decoded remainder the catch-all captured; *raw*
    is the path as sent, when the server gives it.
    """

    prefix = (public[: -len(below)] if public.endswith(below) else "") if below else public
    mounted_at = prefix.rstrip("/")
    decoded = below if below.startswith("/") else "/" + below
    sent = path_below(raw, mounted_at) if raw is not None else None
    return MountedPath(path=sent if sent is not None else decoded, mounted_at=mounted_at)
