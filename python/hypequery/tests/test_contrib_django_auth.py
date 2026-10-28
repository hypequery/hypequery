"""`django_user` and Django's CSRF middleware for context-authenticated APIs.

A signed-in Django session reaches the endpoints with no token, under WSGI
(the user loaded on the request's own thread) and ASGI (the async ORM). Django's
CSRF middleware checks a context-authenticated API's unsafe requests and still
exempts a header credential's.
"""

from __future__ import annotations

import asyncio
import itertools
import threading
from typing import Any

import pytest

pytest.importorskip("django")

from django_settings import migrated

migrated()

from asgiref.sync import sync_to_async  # noqa: E402
from django.contrib.auth.models import User  # noqa: E402
from django.test import AsyncClient, Client, override_settings  # noqa: E402
from django.urls import include, path  # noqa: E402
from pydantic import TypeAdapter  # noqa: E402

from core_transport import CoreClient  # noqa: E402
from hypequery.contrib.django import django_user, urls  # noqa: E402
from hypequery.serve import (  # noqa: E402
    Api,
    Call,
    Principal,
    ServeResponse,
    create_api,
    openapi_document,
)
from test_contrib_django_serve import _urlconf  # noqa: E402

SESSION = "django.contrib.sessions.middleware.SessionMiddleware"
CSRF = "django.middleware.csrf.CsrfViewMiddleware"
AUTHENTICATION = "django.contrib.auth.middleware.AuthenticationMiddleware"
SAME_ORIGIN = {"sec-fetch-site": "same-origin"}
TOKEN = "a" * 32
_names = itertools.count()


class ToPrincipal:
    """Maps a user to its principal through the ORM, recording where it ran."""

    def __init__(self) -> None:
        self.users: list[Any] = []
        self.threads: list[int] = []

    def __call__(self, user: Any) -> Principal:
        self.users.append(user)
        self.threads.append(threading.get_ident())
        # An ORM query: raises SynchronousOnlyOperation on an event loop.
        username = User.objects.get(pk=user.pk).username
        return Principal(subject=username, tenant_id="acme")


def _api(to_principal: Any, **options: Any) -> Api:
    async def whoami(call: Call) -> ServeResponse:
        assert call.auth is not None
        assert call.auth.tenant is not None
        return ServeResponse.json(
            {"subject": call.auth.principal.subject, "tenant": list(call.auth.tenant.ids)}
        )

    api = create_api(auth=django_user(to_principal, **options))
    api.add_route("GET", "/whoami", whoami)
    api.add_route("POST", "/whoami", whoami, input=TypeAdapter(dict[str, object]))
    return api


def _project(api: Api, *middleware: str) -> Any:
    return override_settings(
        ROOT_URLCONF=_urlconf(path("api/", include(urls(api)))),
        MIDDLEWARE=list(middleware) or [SESSION, CSRF, AUTHENTICATION],
        ALLOWED_HOSTS=["testserver"],
    )


def _user() -> Any:
    return User.objects.create_user(f"user{next(_names)}", password="unused")  # noqa: S106 - a test user


def test_a_signed_in_session_is_served_with_no_token_under_wsgi() -> None:
    to_principal = ToPrincipal()
    user = _user()
    with _project(_api(to_principal)):
        http = Client()
        http.force_login(user)
        response = http.get("/api/whoami")
    assert response.status_code == 200
    assert response.json() == {"subject": user.username, "tenant": ["acme"]}
    # The user was loaded, and mapped, on the request's own thread.
    assert to_principal.threads == [threading.get_ident()]
    assert to_principal.users[0].pk == user.pk


def test_a_signed_in_session_is_served_with_no_token_under_asgi() -> None:
    to_principal = ToPrincipal()
    user = _user()

    async def scenario() -> Any:
        http = AsyncClient()
        await http.aforce_login(user)
        return await http.get("/api/whoami")

    with _project(_api(to_principal)):
        response = asyncio.run(scenario())
    assert response.status_code == 200
    assert response.json() == {"subject": user.username, "tenant": ["acme"]}
    assert to_principal.users[0].pk == user.pk
    # Loaded through the async ORM; the sync mapping ran off the event loop.
    assert to_principal.threads != [threading.get_ident()]


def test_an_async_to_principal_is_awaited_under_wsgi_and_asgi() -> None:
    user = _user()

    async def to_principal(signed_in: Any) -> Principal:
        name = await sync_to_async(lambda: User.objects.get(pk=signed_in.pk).username)()
        return Principal(subject=name, tenant_id="acme")

    async def scenario() -> Any:
        http = AsyncClient()
        await http.aforce_login(user)
        return await http.get("/api/whoami")

    with _project(_api(to_principal)):
        http = Client()
        http.force_login(user)
        sync = http.get("/api/whoami")
        asynchronous = asyncio.run(scenario())
    assert sync.json()["subject"] == asynchronous.json()["subject"] == user.username


def test_an_anonymous_user_is_unauthorized_without_calling_to_principal() -> None:
    to_principal = ToPrincipal()
    with _project(_api(to_principal)):
        sync = Client().get("/api/whoami")
        asynchronous = asyncio.run(AsyncClient().get("/api/whoami"))
    for response in (sync, asynchronous):
        assert response.status_code == 401
        assert response.json()["error"]["details"] == {"reason": "missing_credentials"}
    assert to_principal.users == []


def test_django_csrf_checks_a_context_authenticated_api() -> None:
    user = _user()
    with _project(_api(ToPrincipal())):
        http = Client(enforce_csrf_checks=True)
        http.force_login(user)
        refused = http.post(
            "/api/whoami", {"x": 1}, content_type="application/json", headers=SAME_ORIGIN
        )
        http.cookies["csrftoken"] = TOKEN
        accepted = http.post(
            "/api/whoami",
            {"x": 1},
            content_type="application/json",
            headers={**SAME_ORIGIN, "x-csrftoken": TOKEN},
        )
        # Both layers: Django's token passes, the core's same-origin check does not.
        cross_site = http.post(
            "/api/whoami",
            {"x": 1},
            content_type="application/json",
            headers={"sec-fetch-site": "cross-site", "x-csrftoken": TOKEN},
        )
        # Safe methods need no token.
        read = http.get("/api/whoami")
    assert refused.status_code == 403
    assert b"CSRF" in refused.content
    assert accepted.status_code == 200
    assert accepted.json()["subject"] == user.username
    assert cross_site.status_code == 403
    assert cross_site.json()["error"]["details"] == {"reason": "cross_origin"}
    assert read.status_code == 200


def test_django_csrf_checks_a_context_authenticated_api_under_asgi() -> None:
    user = _user()

    async def scenario() -> tuple[Any, Any]:
        http = AsyncClient(enforce_csrf_checks=True)
        await http.aforce_login(user)
        refused = await http.post(
            "/api/whoami", {"x": 1}, content_type="application/json", headers=SAME_ORIGIN
        )
        http.cookies["csrftoken"] = TOKEN
        accepted = await http.post(
            "/api/whoami",
            {"x": 1},
            content_type="application/json",
            headers={**SAME_ORIGIN, "x-csrftoken": TOKEN},
        )
        return refused, accepted

    with _project(_api(ToPrincipal())):
        refused, accepted = asyncio.run(scenario())
    assert refused.status_code == 403
    assert b"CSRF" in refused.content
    assert accepted.status_code == 200


def test_without_authentication_middleware_authentication_is_unavailable() -> None:
    with _project(_api(ToPrincipal()), SESSION):
        response = Client().get("/api/whoami")
    assert response.status_code == 503
    assert response.json()["error"]["type"] == "SERVICE_UNAVAILABLE"


def test_django_user_serves_only_django_requests() -> None:
    response = CoreClient(_api(ToPrincipal())).get("/whoami")
    assert response.status_code == 503


def test_django_user_validates_and_names_the_session_cookie() -> None:
    with pytest.raises(TypeError, match="to_principal"):
        django_user("not callable")  # type: ignore[arg-type]
    strategy = django_user(ToPrincipal(), same_origin=False)
    assert strategy.same_origin is False
    document: Any = openapi_document(_api(ToPrincipal()))
    assert document["components"]["securitySchemes"]["credential"]["name"] == "sessionid"
