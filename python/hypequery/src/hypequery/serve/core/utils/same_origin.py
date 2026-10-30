"""The same-origin check for context (session) authentication (decision 0023 §5).

A browser attaches the host's session cookie to any request for the host's
origin, including one a different site's page makes. For a context strategy,
whose principal comes from that cookie, an unsafe method is accepted only when
the browser says the request came from the page's own origin:

- `Sec-Fetch-Site` is ``same-origin``, or ``none`` (the user's own action,
  not a page's);
- `Origin` is the request's own origin: its scheme and `Host`, as Django's
  CSRF check compares them, for a browser without Fetch Metadata; or
- `Origin` is one the host's CORS policy names, a frontend it trusts.

Both headers are forbidden header names, which page script cannot set. A
request that carries neither is refused, since nothing shows where it came
from. Safe methods change nothing, so they are not checked.

The request's scheme is the one the host saw, or a trusted proxy's
`X-Forwarded-Proto`. Behind a TLS-terminating proxy that is not trusted, the
scheme is ``http`` while the page's `Origin` is ``https``, and the request is
refused rather than matched.
"""

from __future__ import annotations

from ..messages import Headers
from .host_header import request_authority

#: Methods that do not change state (RFC 9110 §9.2.1).
SAFE_METHODS = frozenset(("GET", "HEAD", "OPTIONS", "TRACE"))
_SAME_ORIGIN_SITES = frozenset(("same-origin", "none"))
_DEFAULT_PORTS = {"http": 80, "https": 443}


def trusted_origins(origins: tuple[str, ...]) -> frozenset[str]:
    """The origins a CORS policy names; its ``*`` trusts no particular one."""

    return frozenset(origin for origin in origins if origin != "*")


def same_origin_allowed(
    method: str, headers: Headers, trusted: frozenset[str], scheme: str
) -> bool:
    """Whether a context-authenticated request may proceed.

    *scheme* is the one the request arrived with. A repeated header is not
    believed: a browser sends each once.
    """

    if method in SAFE_METHODS:
        return True
    sites = headers.getlist("sec-fetch-site")
    if len(sites) == 1 and sites[0] in _SAME_ORIGIN_SITES:
        return True
    origins = headers.getlist("origin")
    if len(origins) != 1:
        return False
    if origins[0] in trusted:
        return True
    hosts = headers.getlist("host")
    own = _origin(scheme, hosts[0]) if len(hosts) == 1 else None
    origin_scheme, separator, authority = origins[0].partition("://")
    return own is not None and bool(separator) and _origin(origin_scheme, authority) == own


def _origin(scheme: str, authority: str) -> str | None:
    """``scheme://host[:port]`` in one form, without a default port, or None."""

    default = _DEFAULT_PORTS.get(scheme.lower())
    parsed = request_authority(authority)
    if default is None or parsed is None:
        return None
    host, port = parsed
    suffix = "" if port in (None, default) else f":{port}"
    return f"{scheme.lower()}://{host}{suffix}"
