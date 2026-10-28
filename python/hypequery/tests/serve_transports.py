"""Every way the suite serves an `Api`, behind one client interface.

- ``core``: `Api.handle`, no server at all (`CoreClient`);
- ``asgi``: `to_asgi_app` (`AsgiClient`);
- ``wsgi``: `to_wsgi_app` (`WsgiClient`);
- ``django-wsgi`` / ``django-asgi``: `hypequery.contrib.django.urls` in a
  Django project, served by Django's own WSGI and ASGI handlers, with Django's
  CSRF middleware installed;
- ``flask``: `hypequery.contrib.flask.blueprint` registered on a Flask app.

Each client sends ``Host: testserver`` from the peer ``testclient:50000``
unless told otherwise. *prefix* mounts the API below a URL prefix, for the
transports that have a router.
"""

from __future__ import annotations

import importlib.util
import types
from typing import Any

import httpx

from asgi_client import AsgiClient
from core_transport import CoreClient
from hypequery.serve import Api, to_asgi_app, to_wsgi_app
from wsgi_client import WsgiClient

_INSTALLED = {name: importlib.util.find_spec(name) is not None for name in ("django", "flask")}
#: Every transport whose framework is installed (CI's quality jobs install all).
TRANSPORTS = [
    name
    for name in ["core", "asgi", "wsgi", "django-wsgi", "django-asgi", "flask"]
    if _INSTALLED.get(name.partition("-")[0], True)
]
#: The transports a framework's router mounts below a prefix.
ROUTED = [name for name in ["django-wsgi", "django-asgi", "flask"] if name in TRANSPORTS]
PEER = ("testclient", 50000)

_counter = 0


class DjangoClient:
    """Requests to a Django project whose URLconf includes `urls(api)`."""

    def __init__(
        self, api: Api, *, asgi: bool, client: tuple[str, int], prefix: str, raw_uri: bool
    ) -> None:
        from django.urls import include, path

        from django_settings import configure_django
        from hypequery.contrib.django import urls

        global _counter
        configure_django()
        _counter += 1
        urlconf = types.ModuleType(f"hypequery_test_urlconf_{_counter}")
        if prefix:
            urlconf.urlpatterns = [path(prefix.strip("/") + "/", include(urls(api)))]  # type: ignore[attr-defined]
        else:
            urlconf.urlpatterns = urls(api)  # type: ignore[attr-defined]
        self._settings = {
            "ROOT_URLCONF": urlconf,
            "MIDDLEWARE": ["django.middleware.csrf.CsrfViewMiddleware"],
            "ALLOWED_HOSTS": ["*"],
        }
        with self._overridden():
            if asgi:
                from django.core.handlers.asgi import ASGIHandler

                self._client: AsgiClient | WsgiClient = AsgiClient(ASGIHandler(), client=client)
            else:
                from django.core.handlers.wsgi import WSGIHandler

                self._client = WsgiClient(WSGIHandler(), client=client, raw_uri=raw_uri)

    def _overridden(self) -> Any:
        from django.test import override_settings

        return override_settings(**self._settings)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        with self._overridden():
            return self._client.request(method, url, **kwargs)

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)


def flask_app(api: Api, *, prefix: str = "") -> Any:
    from flask import Flask

    from hypequery.contrib.flask import blueprint

    app = Flask("hypequery_test")
    app.register_blueprint(blueprint(api), url_prefix=prefix or None)
    return app


def serve_client(
    transport: str,
    api: Api,
    *,
    client: tuple[str, int] = PEER,
    prefix: str = "",
    raw_uri: bool = True,
) -> Any:
    """A client for *api* served by *transport*."""

    if prefix and transport not in ROUTED:
        raise ValueError(f"{transport} has no router to mount a prefix")
    if transport == "core":
        return CoreClient(api, client=client)
    if transport == "asgi":
        return AsgiClient(to_asgi_app(api), client=client)
    if transport == "wsgi":
        return WsgiClient(to_wsgi_app(api), client=client, raw_uri=raw_uri)
    if transport in ("django-wsgi", "django-asgi"):
        return DjangoClient(
            api,
            asgi=transport == "django-asgi",
            client=client,
            prefix=prefix,
            raw_uri=raw_uri,
        )
    if transport == "flask":
        return WsgiClient(flask_app(api, prefix=prefix), client=client, raw_uri=raw_uri)
    raise ValueError(f"unknown transport {transport!r}")


def answer(response: httpx.Response) -> tuple[int, dict[str, str], bytes]:
    """What must match across transports: status, headers and body.

    The request id is random, and content-length is the transport's.
    """

    headers = {
        name: value
        for name, value in response.headers.items()
        if name not in ("x-request-id", "content-length")
    }
    return response.status_code, headers, response.content
