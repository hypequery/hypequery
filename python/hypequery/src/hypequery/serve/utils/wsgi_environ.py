"""What a WSGI environ says about a request, in the core's terms.

PEP 3333 hands an application its request as CGI variables: headers as
``HTTP_*`` (a repeated header already joined by the server), the body's type
and length as ``CONTENT_TYPE`` and ``CONTENT_LENGTH``, the peer as
``REMOTE_ADDR``, and every value as a latin-1 string of the bytes sent, which
is how the ASGI adapter decodes them too.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, unquote

from ..core.messages import Headers, QueryParams

#: Sent with ``HTTP_`` by some servers as well as without; the CGI names win.
_CGI_HEADERS = {"CONTENT_TYPE": "content-type", "CONTENT_LENGTH": "content-length"}


#: The port a scheme implies, left out of a host built from the server's name.
_DEFAULT_PORTS = {"http": "80", "https": "443"}


def environ_headers(environ: Mapping[str, Any]) -> Headers:
    """The request headers, names lowercased and ``_`` read as ``-``.

    A request without ``Host`` (HTTP/1.0, or a test client such as Django's)
    is addressed to the server itself: as PEP 3333 reconstructs the URL, its
    host is ``SERVER_NAME``, with ``SERVER_PORT`` unless the scheme implies it.
    Both are the server's configuration, not the caller's.
    """

    headers: list[tuple[str, str]] = []
    for key, value in environ.items():
        if key in _CGI_HEADERS:
            # CGI servers set these empty when the request has none.
            if value:
                headers.append((_CGI_HEADERS[key], value))
        elif key.startswith("HTTP_") and key[5:] not in _CGI_HEADERS:
            headers.append((key[5:].replace("_", "-").lower(), value))
    if "HTTP_HOST" not in environ and environ.get("SERVER_NAME"):
        host = str(environ["SERVER_NAME"])
        port = str(environ.get("SERVER_PORT", ""))
        if port and port != _DEFAULT_PORTS.get(environ.get("wsgi.url_scheme", "http")):
            host = f"{host}:{port}"
        headers.append(("host", host))
    return Headers(headers)


def environ_query(environ: Mapping[str, Any]) -> QueryParams:
    return QueryParams(parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True))


def environ_client(environ: Mapping[str, Any]) -> tuple[str, int] | None:
    """The transport peer, as ``REMOTE_ADDR`` and ``REMOTE_PORT`` name it."""

    address = environ.get("REMOTE_ADDR")
    if not address:
        return None
    port = environ.get("REMOTE_PORT", "")
    return str(address), int(port) if str(port).isdigit() else 0


def request_target_path(environ: Mapping[str, Any]) -> str | None:
    """The path as the client sent it, percent-encoding intact, when the server says.

    PEP 3333 gives only the decoded ``PATH_INFO``. gunicorn and Werkzeug also
    pass the request target as ``RAW_URI``; uWSGI, waitress and mod_wsgi as
    ``REQUEST_URI``.
    """

    target = environ.get("RAW_URI") or environ.get("REQUEST_URI")
    if not isinstance(target, str) or not target:
        return None
    path = target.partition("?")[0].partition("#")[0]
    if not path.startswith("/"):
        # An absolute-form target, as a proxy is sent: drop scheme and authority.
        scheme, separator, rest = path.partition("://")
        if not separator or not scheme.isalpha():
            return None
        path = "/" + rest.partition("/")[2]
    return path


def decoded_path(environ: Mapping[str, Any], key: str = "PATH_INFO") -> str:
    """A CGI path variable, latin-1 as PEP 3333 delivers it, read as UTF-8."""

    value = environ.get(key, "")
    return str(value).encode("latin-1", "replace").decode("utf-8", "replace")


def path_below(raw: str, mount: str) -> str | None:
    """The part of the raw path *raw* below *mount*, a decoded path prefix.

    *mount* is where a router served the request, decoded; *raw* is the
    target as sent. Returns None when no segment boundary of *raw* decodes to
    *mount*, so the caller falls back to the decoded path.
    """

    if not mount:
        return raw if raw.startswith("/") else None
    end = raw.find("/", 1)
    while True:
        prefix = raw if end == -1 else raw[:end]
        decoded = unquote(prefix, errors="replace")
        if decoded == mount:
            return raw[len(prefix) :] or "/"
        if end == -1 or len(decoded) > len(mount):
            return None
        end = raw.find("/", end + 1)


def body_length(environ: Mapping[str, Any]) -> int | None:
    """How much of ``wsgi.input`` is the body: a byte count, or None for all of it.

    With a valid ``CONTENT_LENGTH``, that many bytes. Without one, a server
    that frames the body itself (chunked input) sets ``wsgi.input_terminated``
    and the stream ends with the body; otherwise reading it could block, so
    there is no body, as in Werkzeug. An invalid length reads nothing: the
    core refuses it from the headers before asking for a byte.
    """

    declared = environ.get("CONTENT_LENGTH", "")
    if declared:
        return int(declared) if declared.isascii() and declared.isdigit() else 0
    return None if environ.get("wsgi.input_terminated") else 0


def environ_route_path(environ: Mapping[str, Any]) -> str:
    """The path below ``SCRIPT_NAME``, percent-encoding intact when the server says."""

    raw = request_target_path(environ)
    if raw is not None:
        below = path_below(raw, decoded_path(environ, "SCRIPT_NAME"))
        if below is not None:
            return below
    return decoded_path(environ) or "/"
