"""Serve a hypequery `Api` from Django's own URLconf: ``urls(api)``.

::

    from django.urls import include, path
    from hypequery.contrib.django import urls

    urlpatterns = [path("api/analytics/", include(urls(api)))]

Every request below the prefix reaches the API, which answers it as the core
does, its 404s included. The view is native: async when Django serves the
request on an event loop (ASGI), so the core runs on the server's loop, and
sync under WSGI, where it runs on the process's one serving loop while the
request's thread waits (`hypequery.serve.wsgi`). ``ServeRequest.raw`` is the
`HttpRequest`.

- The body is read through the request's stream, lazily and bounded by the
  API's body policy; ``request.body`` is never touched, so
  ``DATA_UPLOAD_MAX_MEMORY_SIZE`` plays no part. Under ASGI, Django's handler
  has received the whole body before any view runs, so cap request sizes at
  the server or proxy too.
- An API without an ``HttpSecurity`` has its ``Host`` header checked against
  ``ALLOWED_HOSTS`` before it runs, whatever middleware the project has; one
  with an ``HttpSecurity`` checks its own ``allowed_hosts``.
- Any prefix works, including one with URL parameters: client contracts and
  discovery name the paths the request was routed under, unless the API sets
  ``client_mount_path``, which then names where it is reached.
- An API that reads a header credential (bearer, API key, JWT) is
  CSRF-exempt: a browser never attaches that header on its own, so a
  cross-site request cannot carry it. An API authenticated by the project's
  own login (``auth=django_user(...)``, or any ``from_context`` strategy) is
  not: Django's CSRF middleware checks its unsafe requests, so the page sends
  the ``csrftoken`` cookie's value as ``X-CSRFToken`` (``@hypequery/react``'s
  ``headers`` option), as well as the core's same-origin check.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from django.http import HttpRequest, HttpResponse
from django.urls import URLPattern
from django.urls.resolvers import RegexPattern, ResolverMatch
from django.views.decorators.csrf import csrf_exempt

from ...serve.client_contract import export_client_contract
from ...serve.core.api import Api
from ...serve.core.messages import ServeRequest, ServeResponse
from ...serve.utils.asgi_scope import raw_scope_path, scope_client, scope_headers, scope_query
from ...serve.utils.blocking import serve_blocking
from ...serve.utils.fault import answer
from ...serve.utils.response_head import framework_response
from ...serve.utils.serving_loop import RequestThread
from ...serve.utils.thread_body import CHUNK_BYTES, thread_body
from ...serve.utils.wsgi_environ import (
    body_length,
    environ_client,
    environ_headers,
    environ_query,
    request_target_path,
)
from ..utils.mounted_path import MountedPath, mounted_path

__all__ = ["urls"]

#: The URL keyword the catch-all pattern captures the path below the prefix in.
_PATH = "hypequery_path"


class _ServePattern(URLPattern):  # type: ignore[misc]
    """Resolves to the async view on an event loop, and to the sync view otherwise.

    Django picks a view's calling convention from the view itself, but whether
    a request is served on an event loop is a property of the server. Django
    resolves an ASGI request on its loop and a WSGI request on the server's
    thread, so the resolver picks the view that suits the request it serves.
    """

    def __init__(self, sync_view: Callable[..., HttpResponse], async_view: Any) -> None:
        super().__init__(RegexPattern(rf"^(?P<{_PATH}>.*)\Z", is_endpoint=True), sync_view)
        self.async_view = async_view

    def resolve(self, path: str) -> ResolverMatch | None:
        match = super().resolve(path)
        if match is not None and _on_event_loop():
            match.func = self.async_view
        return match


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def urls(api: Api) -> list[URLPattern]:
    """URL patterns serving *api*, for ``include()`` below any prefix.

    When *api* serves strict client endpoints, their contract is checked now,
    so a misconfiguration fails at startup rather than on the first request.
    """

    if not isinstance(api, Api):
        raise TypeError("urls requires an Api from create_api")
    if api.client_endpoints.bindings:
        export_client_contract(api)

    def hypequery_api(request: HttpRequest, **kwargs: Any) -> HttpResponse:
        where = _where(api, request, kwargs[_PATH])

        def build(thread: RequestThread) -> ServeRequest:
            return _wsgi_request(request, where, thread)

        return _response(serve_blocking(api, build, mounted_at=where.mounted_at))

    async def hypequery_api_async(request: HttpRequest, **kwargs: Any) -> HttpResponse:
        where = _where(api, request, kwargs[_PATH])
        response = await answer(api, _asgi_request(request, where), mounted_at=where.mounted_at)
        return _response(response)

    views: tuple[Callable[..., Any], Callable[..., Awaitable[HttpResponse]]] = (
        hypequery_api,
        hypequery_api_async,
    )
    if api.authentication.context is None:
        views = (csrf_exempt(views[0]), csrf_exempt(views[1]))
    return [_ServePattern(*views)]


def _where(api: Api, request: HttpRequest, below: str) -> MountedPath:
    if api.security is None:
        # An API without an HttpSecurity checks no host itself, and Django
        # applies ALLOWED_HOSTS only when something calls get_host(), which
        # without CommonMiddleware nothing would. DisallowedHost answers 400.
        request.get_host()
    scope = getattr(request, "scope", None)
    raw = raw_scope_path(scope) if scope is not None else request_target_path(request.META)
    return mounted_path(request.path, below, raw)


def _wsgi_request(request: HttpRequest, where: MountedPath, thread: RequestThread) -> ServeRequest:
    environ = request.META
    length = body_length(environ)
    # Django reads no body without a Content-Length; a chunked body the server
    # framed is read from the server's stream itself.
    read = environ["wsgi.input"].read if length is None else request.read
    return ServeRequest(
        method=request.method or "GET",
        path=where.path,
        query=environ_query(environ),
        headers=environ_headers(environ),
        body=thread_body(thread, read, length),
        client=environ_client(environ),
        raw=request,
        run_on_request_thread=thread.call,
    )


def _asgi_request(request: HttpRequest, where: MountedPath) -> ServeRequest:
    # Django's ASGI handler has buffered the body and cancels the view when
    # the caller disconnects, which cancels the core's query with it.
    scope: dict[str, Any] = request.scope
    return ServeRequest(
        method=request.method or "GET",
        path=where.path,
        query=scope_query(scope),
        headers=scope_headers(scope),
        body=_buffered_body(request),
        client=scope_client(scope),
        raw=request,
    )


async def _buffered_body(request: HttpRequest) -> AsyncIterator[bytes]:
    while chunk := request.read(CHUNK_BYTES):
        yield chunk


def _response(response: ServeResponse) -> HttpResponse:
    return framework_response(response, lambda body, status: HttpResponse(body, status=status))
