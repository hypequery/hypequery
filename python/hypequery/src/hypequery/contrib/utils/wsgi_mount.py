"""Route one URL prefix of a WSGI application to an ASGI app.

The ASGI app runs through ``a2wsgi``, which keeps one event loop on a
background thread for the whole process, so loop-bound state in the mounted app
(executor admission queues, for one) behaves as it would under an ASGI server.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, TypeAlias, cast

from .asgi_mount import ASGIApp, under_prefix, validate_prefix

WSGIEnviron: TypeAlias = dict[str, Any]
StartResponse: TypeAlias = Callable[..., Any]
WSGIApp: TypeAlias = Callable[[WSGIEnviron, StartResponse], Iterable[bytes]]


def mount_wsgi(host: WSGIApp, mounted: ASGIApp, *, prefix: str) -> WSGIApp:
    """*host*, except that requests under *prefix* go to the ASGI app *mounted*.

    Requires ``a2wsgi`` (installed by ``hypequery[flask]``).
    """

    prefix = validate_prefix(prefix)
    try:
        from a2wsgi import ASGIMiddleware
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            'Mounting an ASGI app in a WSGI app needs a2wsgi: pip install "hypequery[flask]"'
        ) from exc
    bridge = cast(WSGIApp, ASGIMiddleware(cast(Any, mounted)))

    def application(environ: WSGIEnviron, start_response: StartResponse) -> Iterable[bytes]:
        path: str = environ.get("PATH_INFO", "")
        if not under_prefix(path, prefix):
            return host(environ, start_response)
        child = dict(environ)
        child["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + prefix
        child["PATH_INFO"] = path[len(prefix) :]
        return bridge(child, start_response)

    return application
