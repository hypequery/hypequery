"""``django_user``: hypequery endpoints authenticated by the project's own login.

::

    from hypequery.contrib.django import django_user
    from hypequery.serve import Principal, create_api

    def to_principal(user):
        return Principal(subject=str(user.pk), tenant_id=str(user.profile.org_id))

    api = create_api(auth=django_user(to_principal), ...)

A page served by the same project then calls the endpoints with its session
cookie and no token. Django's ``SessionMiddleware`` and
``AuthenticationMiddleware`` must run for the API's URLs, and its CSRF
middleware checks unsafe requests (`views.py`).
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any, TypeAlias, cast

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest

from ...serve.core.auth import Principal
from ...serve.core.context_auth import ContextStrategy
from ...serve.core.messages import ServeRequest
from ...serve.core.utils.provider_call import is_async_callable

__all__ = ["UserPrincipal", "django_user"]

#: Maps a signed-in Django user to its principal, or None to refuse it. It may
#: be async; a sync one may use the ORM, in sync and async views alike.
UserPrincipal: TypeAlias = Callable[[Any], Awaitable[Principal | None] | Principal | None]


def django_user(to_principal: UserPrincipal, *, same_origin: bool = True) -> ContextStrategy:
    """A `from_context` strategy reading ``request.user``, for `create_api(auth=...)`.

    *to_principal* receives the signed-in user and returns its `Principal`.
    An anonymous user is answered 401 without calling it. Under WSGI the user
    is loaded, and *to_principal* runs, on the request's own thread, where
    Django manages its database connection; under ASGI the user is loaded
    through the async ORM (``request.auser()``) and a sync *to_principal* runs
    through ``sync_to_async``. *same_origin* is `from_context`'s check.
    """

    if not callable(to_principal):
        raise TypeError("django_user requires a to_principal callable")
    cookie = settings.SESSION_COOKIE_NAME if settings.configured else "sessionid"
    return ContextStrategy(_DjangoUser(to_principal), same_origin, session_cookie=cookie)


class _DjangoUser:
    """Reads the request's user: on the request's thread, or through the async ORM."""

    __slots__ = ("_to_principal",)

    def __init__(self, to_principal: UserPrincipal) -> None:
        self._to_principal = to_principal

    async def __call__(self, request: ServeRequest) -> Principal | None:
        raw = _django_request(request)
        result: object
        if request.run_on_request_thread is not None:
            # A sync view: the lazy `request.user` and anything to_principal
            # reads hit the ORM, whose connections are per thread.
            result = await request.run_on_request_thread(lambda: self._sync(raw))
        else:
            user = await raw.auser()
            if not user.is_authenticated:
                return None
            convert = self._to_principal
            result = (convert if is_async_callable(convert) else sync_to_async(convert))(user)
        if inspect.isawaitable(result):
            result = await result
        # The core refuses anything but a Principal or None.
        return cast("Principal | None", result)

    def _sync(self, raw: HttpRequest) -> Awaitable[Principal | None] | Principal | None:
        user = raw.user
        return self._to_principal(user) if user.is_authenticated else None


def _django_request(request: ServeRequest) -> HttpRequest:
    raw = request.raw
    if not isinstance(raw, HttpRequest):
        raise TypeError("django_user reads requests served by hypequery.contrib.django.urls")
    if not hasattr(raw, "user"):
        raise ImproperlyConfigured(
            "django_user requires django.contrib.auth's AuthenticationMiddleware"
        )
    return raw
