"""hypequery.contrib.django: settings, system check, middleware, clients, ASGI mount."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator, MutableMapping
from typing import Any

import pytest

django = pytest.importorskip("django")

from django.conf import settings  # noqa: E402

if not settings.configured:
    settings.configure(
        DEBUG=False,
        SECRET_KEY="hypequery-tests",  # noqa: S106 - a test secret
        ALLOWED_HOSTS=["testserver"],
        ROOT_URLCONF=__name__,
        INSTALLED_APPS=["hypequery.contrib.django"],
        MIDDLEWARE=["hypequery.contrib.django.HypequeryMiddleware"],
        HYPEQUERY={
            "URL": "clickhouse://reader@ch/hq",
            "REGISTRY": "contrib_doubles.REGISTRY",
            "TENANT": f"{__name__}.tenant_for",
            "TIMEZONE": "UTC",
            "MAX_CONCURRENT": 2,
        },
    )
    django.setup()

import httpx  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402
from django.http import HttpRequest, JsonResponse  # noqa: E402
from django.test import AsyncClient, Client, override_settings  # noqa: E402
from django.urls import path  # noqa: E402
from django.utils.asyncio import async_unsafe  # noqa: E402

from contrib_doubles import Built, install_executors, query  # noqa: E402
from hypequery.contrib.django import (  # noqa: E402
    close_clients,
    get_async_client,
    get_client,
    tenant_client,
)
from hypequery.contrib.django.apps import check_settings  # noqa: E402
from hypequery.contrib.django.asgi import mount_serve  # noqa: E402
from hypequery.contrib.django.conf import load_settings  # noqa: E402
from hypequery.datasets import CompiledQueryError, TenantDatasetClient  # noqa: E402

SECRET = "pa55word"  # noqa: S105 - a test credential


CALLS: list[str] = []


@async_unsafe("a tenant lookup that queries the database")  # type: ignore[untyped-decorator]
def database_tenant_for(request: HttpRequest) -> str | None:
    """Raises SynchronousOnlyOperation on the event loop, as an ORM query would."""

    CALLS.append("tenant")
    org: str | None = request.headers.get("X-Org")
    return org


def tenant_for(request: HttpRequest) -> str | None:
    org: str | None = request.headers.get("X-Org")
    return org


def _rows(request: HttpRequest, dataset: str) -> JsonResponse:
    try:
        result = request.analytics.execute(dataset, {"dimensions": ["status"]})
    except CompiledQueryError as exc:
        return JsonResponse({"error": exc.category}, status=403)
    return JsonResponse({"data": list(result.data), "types": list(result.column_types)})


def orders_view(request: HttpRequest) -> JsonResponse:
    return _rows(request, "orders")


def open_view(request: HttpRequest) -> JsonResponse:
    return _rows(request, "open_stats")


def idle_view(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"ok": True})


async def async_orders_view(request: HttpRequest) -> JsonResponse:
    result, again = await asyncio.gather(
        request.analytics.execute("orders", {"dimensions": ["status"]}),
        request.analytics.execute("orders", {"dimensions": ["status"]}),
    )
    same = await request.analytics.client() is await request.analytics.client()
    return JsonResponse({"data": list(result.data), "same": same and again.data == result.data})


urlpatterns = [
    path("orders", orders_view),
    path("open", open_view),
    path("idle", idle_view),
    path("async-orders", async_orders_view),
]


@pytest.fixture
def built(monkeypatch: pytest.MonkeyPatch) -> Iterator[Built]:
    close_clients()
    load_settings.cache_clear()
    yield install_executors(monkeypatch)
    close_clients()


def test_sync_views_get_a_tenant_bound_client(built: Built) -> None:
    response = Client().get("/orders", headers={"X-Org": "org_a"})
    assert response.status_code == 200
    assert json.loads(response.content) == {
        "data": [{"status": "paid", "orders": 3}],
        "types": ["string", "integer"],
    }
    assert "org_a" in built.tenants()
    [executor] = built.sync
    assert (executor.connection.host, executor.connection.database) == ("ch", "hq")


def test_no_tenant_means_tenant_keyed_datasets_refuse(built: Built) -> None:
    assert Client().get("/orders").json() == {"error": "tenant-required"}
    assert Client().get("/open").status_code == 200


def test_the_client_is_built_only_when_a_view_uses_it(built: Built) -> None:
    assert Client().get("/idle", headers={"X-Org": "org_a"}).status_code == 200
    assert built.sync == []


def test_async_views_get_the_async_client(built: Built) -> None:
    async def call() -> Any:
        return await AsyncClient().get("/async-orders", headers={"X-Org": "org_b"})

    response = asyncio.run(call())
    assert response.status_code == 200
    assert json.loads(response.content) == {
        "data": [{"status": "paid", "orders": 3}],
        "same": True,
    }
    assert built.sync == []
    [executor] = built.async_
    assert executor.max_concurrent == 2
    assert "org_b" in built.tenants()


def test_process_clients_are_shared_and_closed(built: Built) -> None:
    assert get_client() is get_client()
    query(get_client())
    request = HttpRequest()
    request.META["HTTP_X_ORG"] = "org_a"
    assert isinstance(tenant_client(request), TenantDatasetClient)

    async def both() -> tuple[object, object]:
        return get_async_client(), get_async_client()

    first, second = asyncio.run(both())
    assert first is second
    close_clients()
    assert (built.sync[0].closed, built.async_[0].closed) == (1, 1)


def test_changing_the_setting_rebuilds_the_client(built: Built) -> None:
    query(get_client())
    with override_settings(
        HYPEQUERY={"URL": "clickhouse://other/db", "REGISTRY": "contrib_doubles.REGISTRY"}
    ):
        assert built.sync[0].closed == 1
        query(get_client())
        assert built.sync[1].connection.host == "other"


def test_no_tenant_setting_means_an_unscoped_client(built: Built) -> None:
    with override_settings(
        HYPEQUERY={"URL": "clickhouse://ch", "REGISTRY": "contrib_doubles.REGISTRY"}
    ):
        assert Client().get("/open", headers={"X-Org": "org_a"}).status_code == 200
        assert built.tenants() == []


def test_url_unset_reads_the_environment(built: Built, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLICKHOUSE_URL", "clickhouses://env-host/envdb")
    for name in (
        "CLICKHOUSE_HOST",
        "CLICKHOUSE_PORT",
        "CLICKHOUSE_DATABASE",
        "CLICKHOUSE_USERNAME",
        "CLICKHOUSE_PASSWORD",
        "CLICKHOUSE_SECURE",
    ):
        monkeypatch.delenv(name, raising=False)
    with override_settings(HYPEQUERY={"REGISTRY": "contrib_doubles.REGISTRY"}):
        query(get_client())
    assert (built.sync[0].connection.host, built.sync[0].connection.secure) == ("env-host", True)


def test_the_system_check_passes_valid_settings() -> None:
    assert check_settings() == []


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ([], "must be a dict"),
        ({"REGISTRY_PATH": "x"}, "unknown keys: REGISTRY_PATH"),
        ({"REGISTRY": "contrib_doubles.nowhere"}, "REGISTRY'] could not be imported"),
        ({"REGISTRY": "contrib_doubles.ORDERS"}, "must be a DatasetRegistry"),
        ({"TENANT": "contrib_doubles.ORDERS"}, "must be a callable"),
        ({"TIMEZONE": 5}, "Invalid timezone"),
        ({"TIMEZONE": "Mars/Olympus"}, "Invalid timezone"),
        ({"MAX_CONCURRENT": "4"}, "max_concurrent must be an integer"),
        ({"MAX_CONCURRENT": 0}, "between 1 and 128"),
        ({"URL": 5}, "URL'] must be a string"),
        ({"URL": f"clickhouse+native://u:{SECRET}@ch"}, "native protocol"),
        ({"URL": "clickhouse://ch", "READONLY_POLICY": "never"}, "connection settings"),
    ],
)
def test_the_system_check_reports_bad_settings(value: object, message: str) -> None:
    with override_settings(HYPEQUERY=value):
        errors = check_settings()
    assert [error.id for error in errors] == ["hypequery.E001"]
    assert message in errors[0].msg
    assert SECRET not in errors[0].msg


def test_the_system_check_skips_other_apps() -> None:
    from django.apps import apps

    with override_settings(HYPEQUERY={"TIMEZONE": 5}):
        assert check_settings(app_configs=[]) == []
        assert check_settings(app_configs=[apps.get_app_config("hypequery")]) != []


def test_the_check_is_registered() -> None:
    from django.core import checks

    assert check_settings in checks.registry.registry.get_checks()


def test_mount_serve_splits_one_asgi_process() -> None:
    async def serve_app(scope: MutableMapping[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            message = await receive()
            await send({"type": message["type"] + ".complete"})
            return
        body = json.dumps({"root_path": scope["root_path"], "path": scope["path"]}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    application = mount_serve(get_asgi_application(), serve_app)

    async def scenario() -> tuple[httpx.Response, httpx.Response, list[MutableMapping[str, Any]]]:
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            mounted = await http.get("/analytics/datasets/orders")
            hosted = await http.get("/idle")
        sent: list[MutableMapping[str, Any]] = []

        async def receive() -> dict[str, Any]:
            return {"type": "lifespan.startup"}

        async def send(message: MutableMapping[str, Any]) -> None:
            sent.append(message)

        await application({"type": "lifespan"}, receive, send)
        return mounted, hosted, sent

    mounted, hosted, lifespan = asyncio.run(scenario())
    assert mounted.json() == {"root_path": "/analytics", "path": "/analytics/datasets/orders"}
    assert hosted.json() == {"ok": True}
    assert lifespan == [{"type": "lifespan.startup.complete"}]


def test_async_views_resolve_a_database_backed_tenant_off_the_event_loop(built: Built) -> None:
    hypequery = {**settings.HYPEQUERY, "TENANT": f"{__name__}.database_tenant_for"}
    CALLS.clear()

    async def call() -> Any:
        return await AsyncClient().get("/async-orders", headers={"X-Org": "org_c"})

    with override_settings(HYPEQUERY=hypequery):
        response = asyncio.run(call())
    assert response.status_code == 200, response.content
    assert "org_c" in built.tenants()
    # Two concurrent queries, one tenant lookup: the bound client is cached for the request.
    assert CALLS == ["tenant"]


def test_getting_the_client_does_not_connect(built: Built) -> None:
    """Serve endpoints installed at import time hold the client before ClickHouse is needed."""

    client = get_client()
    assert built.sync == []
    query(client)
    assert len(built.sync) == 1
