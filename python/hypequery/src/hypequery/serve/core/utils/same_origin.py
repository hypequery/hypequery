"""The same-origin check for context (session) authentication (decision 0023 §5).

A browser attaches the host's session cookie to any request for the host's
origin, including one a different site's page makes. For a context strategy,
whose principal comes from that cookie, an unsafe method is accepted only when
the browser says the request came from the page's own origin:

- `Sec-Fetch-Site` is ``same-origin``, or ``none`` (the user's own action,
  not a page's); or
- `Origin` is one the host's CORS policy names, a frontend it trusts.

Both headers are forbidden header names, which page script cannot set. A
request that carries neither, such as one from a browser without Fetch
Metadata, is refused, since nothing shows where it came from. Safe methods
change nothing, so they are not checked.
"""

from __future__ import annotations

from ..messages import Headers

#: Methods that do not change state (RFC 9110 §9.2.1).
SAFE_METHODS = frozenset(("GET", "HEAD", "OPTIONS", "TRACE"))
_SAME_ORIGIN_SITES = frozenset(("same-origin", "none"))


def trusted_origins(origins: tuple[str, ...]) -> frozenset[str]:
    """The origins a CORS policy names; its ``*`` trusts no particular one."""

    return frozenset(origin for origin in origins if origin != "*")


def same_origin_allowed(method: str, headers: Headers, trusted: frozenset[str]) -> bool:
    """Whether a context-authenticated request may proceed.

    A repeated header is not believed: a browser sends each once.
    """

    if method in SAFE_METHODS:
        return True
    sites = headers.getlist("sec-fetch-site")
    if len(sites) == 1 and sites[0] in _SAME_ORIGIN_SITES:
        return True
    origins = headers.getlist("origin")
    return len(origins) == 1 and origins[0] in trusted
