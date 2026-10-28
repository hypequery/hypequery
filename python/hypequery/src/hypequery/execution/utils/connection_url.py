"""Read ClickHouse connection fields from a URL.

Accepts the HTTP-interface spellings hypequery can actually connect with, plus
the SQLAlchemy dialect names that point at that same interface, so one URL can
configure both. Native-protocol URLs are refused: hypequery binds values as
server-side ``{name:Type}`` parameters, which only the HTTP interface carries.

A URL usually carries a password, so no error here ever echoes it, or any
part of it beyond a scheme or a query-parameter name.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Literal
from urllib.parse import parse_qsl, unquote, urlsplit

if TYPE_CHECKING:
    from .connection_env import ConnectionFields

#: Scheme to whether it implies TLS. ``None``: decided by query parameters.
_SCHEMES: Mapping[str, bool | None] = {
    "clickhouse": False,
    "clickhouses": True,
    "http": False,
    "https": True,
    # SQLAlchemy: clickhouse-connect's own dialect, and clickhouse-sqlalchemy's
    # HTTP driver. Both default to plain HTTP unless the query says otherwise.
    "clickhousedb": None,
    "clickhousedb+connect": None,
    "clickhouse+http": None,
}

_NATIVE_SCHEMES = frozenset(("clickhouse+native", "clickhouse+asynch"))

#: Query parameters that only choose TLS; anything else is refused.
_TLS_PARAMETERS = frozenset(("secure", "protocol"))

_TRUE = frozenset(("1", "true", "yes", "on"))
_FALSE = frozenset(("0", "false", "no", "off"))


def _secure_from_query(query: Mapping[str, str], default: bool) -> bool:
    secure = default
    if "protocol" in query:
        protocol = query["protocol"].strip().lower()
        if protocol not in ("http", "https"):
            raise ValueError("a ClickHouse URL's protocol parameter must be http or https")
        secure = protocol == "https"
    if "secure" in query:
        raw = query["secure"].strip().lower()
        if raw not in _TRUE | _FALSE:
            raise ValueError("a ClickHouse URL's secure parameter must be true or false")
        secure = raw in _TRUE
    return secure


def url_parts_fields(
    *,
    scheme: str,
    host: str | None,
    port: int | None,
    username: str | None,
    password: str | None,
    database: str | None,
    query: Mapping[str, str],
    other_parameters: Literal["refuse", "ignore"] = "refuse",
) -> ConnectionFields:
    """Connection fields from already-split URL parts.

    Shared by :func:`url_fields` and callers that hold a parsed URL object, such
    as a SQLAlchemy ``Engine.url``, so neither renders a password into a string.
    A URL written for hypequery refuses parameters it would not read; an
    engine's URL may carry its dialect's own options, which are ignored.
    """

    scheme = scheme.lower()
    if scheme in _NATIVE_SCHEMES:
        raise ValueError(
            f"{scheme}:// uses ClickHouse's native protocol; hypequery needs the HTTP "
            "interface (clickhousedb://, clickhouse+http:// or https://, usually port 8123 "
            "or 8443)"
        )
    if scheme not in _SCHEMES:
        known = ", ".join(sorted(_SCHEMES))
        raise ValueError(f"unsupported ClickHouse URL scheme {scheme!r}; expected one of {known}")
    unknown = sorted(set(query) - _TLS_PARAMETERS)
    if unknown and other_parameters == "refuse":
        raise ValueError(
            "unsupported ClickHouse URL parameter(s): "
            f"{', '.join(unknown)}; only secure and protocol are read"
        )
    implied = _SCHEMES[scheme]
    secure = _secure_from_query(query, default=bool(implied))
    if implied is not None and secure != implied:
        raise ValueError(f"{scheme}:// conflicts with the URL's secure or protocol parameter")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("a ClickHouse URL's port must be between 1 and 65535")
    return {
        "host": host or "localhost",
        "port": port,
        "database": database or "default",
        "username": username or "default",
        "password": password or "",
        "secure": secure,
    }


def url_fields(url: str) -> ConnectionFields:
    """Validated connection fields from *url*, e.g. ``clickhouses://user:pw@host/db``."""

    if type(url) is not str:
        raise TypeError("a ClickHouse URL must be a string")
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        # urllib's messages can quote the netloc, which holds the password.
        raise ValueError("a ClickHouse URL's port must be an integer between 1 and 65535") from None
    if not parts.scheme or not parts.netloc:
        raise ValueError("a ClickHouse URL needs a scheme and a host, e.g. clickhouse://host")
    if parts.fragment:
        raise ValueError("a ClickHouse URL cannot have a fragment")
    path = unquote(parts.path.strip("/"))
    if "/" in path:
        raise ValueError("a ClickHouse URL's path is a single database name")
    try:
        query = dict(parse_qsl(parts.query, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        raise ValueError("a ClickHouse URL's query string is malformed") from None
    return url_parts_fields(
        scheme=parts.scheme,
        host=parts.hostname,
        port=port,
        username=unquote(parts.username) if parts.username is not None else None,
        password=unquote(parts.password) if parts.password is not None else None,
        database=path or None,
        query=query,
    )
