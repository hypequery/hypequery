"""`hypequery.contrib.django.urls`: CSRF, bodies, and Django's own test clients."""

from __future__ import annotations

import asyncio
import io
import types
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("django")

from django_settings import configure_django

configure_django()

from django.http import HttpRequest, HttpResponse  # noqa: E402
from django.test import AsyncClient, Client, override_settings  # noqa: E402
from django.urls import include, path  # noqa: E402
from pydantic import TypeAdapter  # noqa: E402

from hypequery.contrib.django import urls  # noqa: E402
from hypequery.serve import (  # noqa: E402
    Api,
    Call,
    Credential,
    Principal,
    ServeRequest,
    ServeResponse,
    create_api,
    from_context,
)
from serve_transports import serve_client  # noqa: E402
from wsgi_client import call, environ  # noqa: E402

AUTH = {"authorization": "Bearer reader"}
_count = 0


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value in ("reader", "session=reader") else None


def _api(**options: Any) -> Api:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({"input": call.input})

    api = create_api(auth=_authenticate, **options)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    return api


def _urlconf(*patterns: Any) -> types.ModuleType:
    global _count
    _count += 1
    module = types.ModuleType(f"hypequery_django_serve_{_count}")
    module.urlpatterns = list(patterns)  # type: ignore[attr-defined]
    return module


def _project(api: Api, *middleware: str, **settings: Any) -> Any:
    return override_settings(
        ROOT_URLCONF=_urlconf(path("api/", include(urls(api)))),
        MIDDLEWARE=list(middleware),
        ALLOWED_HOSTS=["testserver"],
        **settings,
    )


def test_urls_checks_its_argument_and_the_client_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(TypeError, match="create_api"):
        urls(object())  # type: ignore[arg-type]
    api = _api()
    checked: list[Api] = []
    monkeypatch.setattr(
        "hypequery.contrib.django.views.export_client_contract", lambda api: checked.append(api)
    )
    urls(api)
    assert checked == []
    monkeypatch.setattr(type(api.client_endpoints), "bindings", property(lambda self: (object(),)))
    urls(api)
    assert checked == [api]


def test_header_credentials_pass_django_csrf_checks() -> None:
    with _project(_api(), "django.middleware.csrf.CsrfViewMiddleware"):
        response = Client(enforce_csrf_checks=True).post(
            "/api/echo", {"x": 1}, content_type="application/json", headers=AUTH
        )
    assert response.status_code == 200
    assert response.json() == {"input": {"x": 1}}


def test_a_context_strategy_is_left_to_django_csrf() -> None:
    def signed_in(request: ServeRequest) -> Principal:
        return Principal(subject="reader")

    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({"input": call.input})

    api = create_api(auth=from_context(signed_in))
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    with _project(api, "django.middleware.csrf.CsrfViewMiddleware"):
        http = Client(enforce_csrf_checks=True)
        refused = http.post(
            "/api/echo",
            {"x": 1},
            content_type="application/json",
            headers={"sec-fetch-site": "same-origin"},
        )
    assert refused.status_code == 403
    assert b"CSRF" in refused.content


def test_the_body_is_not_subject_to_data_upload_max_memory_size() -> None:
    payload = {"x": "y" * 5_000}
    with _project(_api(), DATA_UPLOAD_MAX_MEMORY_SIZE=100):
        response = Client().post(
            "/api/echo", payload, content_type="application/json", headers=AUTH
        )
    assert response.status_code == 200
    assert response.json() == {"input": payload}


def test_a_body_middleware_already_read_is_still_served() -> None:
    def reads_the_body(get_response: Callable[[HttpRequest], HttpResponse]) -> Any:
        def middleware(request: HttpRequest) -> HttpResponse:
            assert request.body
            return get_response(request)

        return middleware

    module = types.ModuleType("hypequery_body_reader")
    module.reads_the_body = reads_the_body  # type: ignore[attr-defined]
    import sys

    sys.modules[module.__name__] = module
    try:
        with _project(_api(), "hypequery_body_reader.reads_the_body"):
            response = Client().post(
                "/api/echo", {"x": 2}, content_type="application/json", headers=AUTH
            )
    finally:
        del sys.modules[module.__name__]
    assert response.json() == {"input": {"x": 2}}


def test_a_chunked_body_the_server_framed_is_read_from_its_stream() -> None:
    from django.core.handlers.wsgi import WSGIHandler

    with _project(_api()):
        built = environ(
            "POST",
            "/api/echo",
            headers=[
                ("host", "testserver"),
                ("authorization", "Bearer reader"),
                ("content-type", "application/json"),
                ("transfer-encoding", "chunked"),
            ],
            input_stream=io.BytesIO(b'{"x": 3}'),
        )
        built["wsgi.input_terminated"] = True
        response = call(WSGIHandler(), built)
    assert response.status_code == 200, response.text
    assert response.json() == {"input": {"x": 3}}


def test_django_test_clients_reach_the_api_sync_and_async() -> None:
    with _project(_api()):
        sync = Client().post("/api/echo", {"x": 4}, content_type="application/json", headers=AUTH)

        async def post() -> Any:
            return await AsyncClient().post(
                "/api/echo", {"x": 5}, content_type="application/json", headers=AUTH
            )

        asynchronous = asyncio.run(post())
    assert sync.json() == {"input": {"x": 4}}
    assert asynchronous.json() == {"input": {"x": 5}}


def test_allowed_hosts_is_checked_without_common_middleware() -> None:
    # The project has no CommonMiddleware, which would otherwise call
    # get_host(), and the API has no HttpSecurity of its own.
    with _project(_api()):
        sync = Client(raise_request_exception=False).post(
            "/api/echo",
            {"x": 1},
            content_type="application/json",
            headers={**AUTH, "host": "evil.example", "x-request-id": "trace-1"},
        )

        async def post() -> Any:
            return await AsyncClient(raise_request_exception=False).post(
                "/api/echo",
                {"x": 1},
                content_type="application/json",
                headers={**AUTH, "host": "evil.example", "x-request-id": "trace-1"},
            )

        asynchronous = asyncio.run(post())
        allowed = Client().post(
            "/api/echo", {"x": 1}, content_type="application/json", headers=AUTH
        )
    for refused in (sync, asynchronous):
        # The core's refusal, not Django's HTML (or DEBUG technical) page.
        assert refused.status_code == 400
        assert refused["Content-Type"] == "text/plain; charset=utf-8"
        assert refused.content == b"Invalid host header"
        assert refused["Cache-Control"] == "no-store"
        assert refused["X-Content-Type-Options"] == "nosniff"
        assert len(refused["X-Request-Id"]) == 32
        assert refused["X-Correlation-Id"] == "trace-1"
    assert allowed.status_code == 200


def test_a_disallowed_host_is_logged_as_django_logs_it(caplog: pytest.LogCaptureFixture) -> None:
    with _project(_api()), caplog.at_level("ERROR", logger="django.security.DisallowedHost"):
        Client().post(
            "/api/echo",
            {"x": 1},
            content_type="application/json",
            headers={**AUTH, "host": "evil.example"},
        )
    [record] = [r for r in caplog.records if r.name == "django.security.DisallowedHost"]
    assert "evil.example" in record.getMessage()
    assert record.status_code == 400  # type: ignore[attr-defined]


def test_a_core_response_without_a_content_type_gets_none_from_django() -> None:
    async def empty(call: Call) -> ServeResponse:
        return ServeResponse(status=200, headers={}, body=b"")

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/empty", empty, public=True)
    for transport in ("django-wsgi", "django-asgi"):
        response = serve_client(transport, api).get("/empty")
        assert response.status_code == 200
        assert "content-type" not in response.headers
