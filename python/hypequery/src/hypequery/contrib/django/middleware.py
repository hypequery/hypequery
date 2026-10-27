"""Give each request a lazily built, tenant-bound ``request.analytics``."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.http import HttpRequest, HttpResponseBase
from django.utils.functional import SimpleLazyObject

from .clients import async_tenant_client, tenant_client

_Handler = Callable[[HttpRequest], HttpResponseBase | Awaitable[HttpResponseBase]]


class HypequeryMiddleware:
    """Sets ``request.analytics`` to the request's tenant-bound client.

    The client is built on first access, so a request that never queries pays
    nothing, and the tenant function runs after authentication middleware has
    loaded the user. Sync views get the sync client; async views get the async
    one. Place it after ``AuthenticationMiddleware``.
    """

    sync_capable = True
    async_capable = True

    def __init__(self, get_response: _Handler) -> None:
        self.get_response = get_response
        self.async_mode = iscoroutinefunction(get_response)
        if self.async_mode:
            markcoroutinefunction(self)

    def __call__(self, request: HttpRequest) -> Any:
        # Both paths only pass through; the work happens in process_view, which
        # is the first hook that knows whether the view is async.
        return self.get_response(request)

    def process_view(
        self,
        request: HttpRequest,
        view_func: Callable[..., object],
        view_args: tuple[object, ...],
        view_kwargs: dict[str, object],
    ) -> None:
        build = async_tenant_client if iscoroutinefunction(view_func) else tenant_client
        request.analytics = SimpleLazyObject(lambda: build(request))
