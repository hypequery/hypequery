"""A synchronous test client for any WSGI application, built on the standard library.

`WsgiClient` speaks the same slice of interface as `AsgiClient` and
`CoreClient`. It builds the environ a real server would: headers as
``HTTP_*`` (a repeated header joined with ``,``, as gunicorn and waitress join
it), ``CONTENT_TYPE`` and ``CONTENT_LENGTH``, the decoded ``PATH_INFO`` below
``SCRIPT_NAME``, and the request target as gunicorn's ``RAW_URI``. Like the
others, it sends ``Host: testserver`` from the peer ``testclient:50000``.
"""

from __future__ import annotations

import io
import json as jsonlib
import sys
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any
from urllib.parse import unquote_to_bytes

import httpx

WsgiApp = Callable[[dict[str, Any], Callable[..., Any]], Iterable[bytes]]


def environ(
    method: str,
    url: str,
    *,
    headers: Sequence[tuple[str, str]] = (),
    body: bytes = b"",
    client: tuple[str, int] = ("testclient", 50000),
    script_name: str = "",
    raw_uri: bool = True,
    input_stream: Any = None,
    scheme: str = "http",
) -> dict[str, Any]:
    """The environ for one request; *url* is the target below *script_name*."""

    path, _, query = url.partition("?")
    full = script_name + path
    built: dict[str, Any] = {
        "REQUEST_METHOD": method,
        "SCRIPT_NAME": unquote_to_bytes(script_name).decode("latin-1"),
        "PATH_INFO": unquote_to_bytes(path).decode("latin-1"),
        "QUERY_STRING": query,
        "SERVER_NAME": "testserver",
        "SERVER_PORT": "443" if scheme == "https" else "80",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "REMOTE_ADDR": client[0],
        "REMOTE_PORT": str(client[1]),
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": scheme,
        "wsgi.input": input_stream if input_stream is not None else io.BytesIO(body),
        "wsgi.errors": sys.stderr,
        "wsgi.multithread": True,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }
    if raw_uri:
        built["RAW_URI"] = full + (f"?{query}" if query else "")
    for name, value in headers:
        key = name.upper().replace("-", "_")
        if key not in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            key = "HTTP_" + key
        built[key] = f"{built[key]},{value}" if key in built else value
    return built


def call(app: WsgiApp, environ: dict[str, Any]) -> httpx.Response:
    """Call *app* as a server would and collect its response."""

    started: list[tuple[str, list[tuple[str, str]]]] = []

    def start_response(status: str, headers: list[tuple[str, str]], exc_info: Any = None) -> None:
        started.append((status, headers))

    result = app(environ, start_response)
    try:
        content = b"".join(result)
    finally:
        close = getattr(result, "close", None)
        if close is not None:
            close()
    status, headers = started[-1]
    return httpx.Response(int(status.split(" ", 1)[0]), headers=headers, content=content)


class WsgiClient:
    def __init__(
        self,
        app: WsgiApp,
        *,
        client: tuple[str, int] = ("testclient", 50000),
        script_name: str = "",
        raw_uri: bool = True,
        scheme: str = "http",
    ) -> None:
        self.app = app
        self.client = client
        self.script_name = script_name
        self.raw_uri = raw_uri
        self.scheme = scheme

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str] | Sequence[tuple[str, str]] | None = None,
        json: Any = None,
        content: bytes | None = None,
    ) -> httpx.Response:
        items = list(headers.items() if isinstance(headers, Mapping) else headers or ())
        sent = [(name.lower(), value) for name, value in items]
        if not any(name == "host" for name, _ in sent):
            sent.insert(0, ("host", "testserver"))
        body = content or b""
        if json is not None:
            body = jsonlib.dumps(json).encode("utf-8")
            sent.append(("content-type", "application/json"))
        if body and not any(name == "content-length" for name, _ in sent):
            sent.append(("content-length", str(len(body))))
        return call(
            self.app,
            environ(
                method,
                url,
                headers=sent,
                body=body,
                client=self.client,
                script_name=self.script_name,
                raw_uri=self.raw_uri,
                scheme=self.scheme,
            ),
        )

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def options(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("OPTIONS", url, **kwargs)
