"""hypequery.contrib.flask: config, tenant loader, per-request clients, Serve mount."""

from __future__ import annotations

import json
from collections.abc import MutableMapping
from typing import Any

import pytest

flask = pytest.importorskip("flask")

from flask import Flask, request  # noqa: E402

from contrib_doubles import REGISTRY, Built, install_executors, query  # noqa: E402
from hypequery.contrib.flask import Hypequery  # noqa: E402
from hypequery.datasets import CompiledQueryError, TenantDatasetClient  # noqa: E402


def _app(hq: Hypequery, **config: object) -> Flask:
    app = Flask(__name__)
    app.config.update({"HYPEQUERY_URL": "clickhouse://ch/hq", "HYPEQUERY_REGISTRY": REGISTRY})
    app.config.update(config)
    hq.init_app(app)

    @app.get("/orders")
    def orders() -> Any:
        try:
            result = hq.client.execute("orders", {"dimensions": ["status"]})
        except CompiledQueryError as exc:
            return {"error": exc.category}, 403
        return {"data": list(result.data), "same": hq.client is hq.client}

    @app.get("/async-orders")
    async def async_orders() -> Any:
        result = await hq.async_client.execute("orders", {"dimensions": ["status"]})
        return {"data": list(result.data), "same": hq.async_client is hq.async_client}

    return app


@pytest.fixture
def built(monkeypatch: pytest.MonkeyPatch) -> Built:
    return install_executors(monkeypatch)


@pytest.fixture
def hq() -> Hypequery:
    extension = Hypequery()

    @extension.tenant_loader
    def tenant() -> str | None:
        return request.headers.get("X-Org")

    return extension


def test_routes_get_a_tenant_bound_client_once_per_request(built: Built, hq: Hypequery) -> None:
    app = _app(hq)
    response = app.test_client().get("/orders", headers={"X-Org": "org_a"})
    assert response.json == {"data": [{"status": "paid", "orders": 3}], "same": True}
    assert "org_a" in built.tenants()
    assert built.sync[0].connection.host == "ch"
    with app.app_context():
        hq.close()
    assert built.sync[0].closed == 1


def test_no_tenant_means_tenant_keyed_datasets_refuse(built: Built, hq: Hypequery) -> None:
    response = _app(hq).test_client().get("/orders")
    assert (response.status_code, response.json) == (403, {"error": "tenant-required"})


def test_without_a_loader_the_client_is_unscoped(built: Built) -> None:
    hq = Hypequery()
    app = _app(hq)
    with app.test_request_context("/"):
        assert hq.client is hq.client
        assert hq.client is hq.base_client


def test_async_routes_get_the_async_client(built: Built) -> None:
    calls: list[str] = []
    hq = Hypequery()

    @hq.tenant_loader
    def tenant() -> str | None:
        calls.append("loaded")
        return request.headers.get("X-Org")

    response = _app(hq).test_client().get("/async-orders", headers={"X-Org": "org_b"})
    assert response.json == {"data": [{"status": "paid", "orders": 3}], "same": True}
    assert calls == ["loaded"]
    assert built.sync == []
    assert "org_b" in built.tenants()


def test_constructor_form_and_import_string_registry(built: Built, hq: Hypequery) -> None:
    app = Flask(__name__)
    app.config.update(
        HYPEQUERY_URL="clickhouses://ch/hq",
        HYPEQUERY_REGISTRY="contrib_doubles:REGISTRY",
        HYPEQUERY_TIMEZONE="Europe/Paris",
        HYPEQUERY_READONLY_POLICY="profile",
    )
    extension = Hypequery(app)
    with app.test_request_context("/", headers={"X-Org": "org_a"}):
        assert extension.base_client.default_timezone == "Europe/Paris"
        query(extension.base_client)
    assert built.sync[0].connection.secure is True
    assert built.sync[0].connection.readonly_policy == "profile"
    with app.test_request_context("/"):
        hq_scoped = hq
        with pytest.raises(RuntimeError, match="not initialised"):
            _ = hq_scoped.base_client


def test_url_unset_reads_the_environment(
    built: Built, hq: Hypequery, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CLICKHOUSE_URL", "clickhouse://env-host/envdb")
    for name in (
        "CLICKHOUSE_HOST",
        "CLICKHOUSE_PORT",
        "CLICKHOUSE_DATABASE",
        "CLICKHOUSE_USERNAME",
        "CLICKHOUSE_PASSWORD",
        "CLICKHOUSE_SECURE",
    ):
        monkeypatch.delenv(name, raising=False)
    app = _app(hq, HYPEQUERY_URL=None)
    query(hq.client_for(app))
    assert built.sync[0].connection.host == "env-host"


@pytest.mark.parametrize(
    ("config", "error", "message"),
    [
        ({"HYPEQUERY_URL": 5}, TypeError, "HYPEQUERY_URL"),
        ({"HYPEQUERY_URL": "clickhouse+native://ch"}, ValueError, "native protocol"),
        ({"HYPEQUERY_REGISTRY": "contrib_doubles:ORDERS"}, TypeError, "DatasetRegistry"),
        ({"HYPEQUERY_REGISTRY": "contrib_doubles:nowhere"}, ImportError, "nowhere"),
        ({"HYPEQUERY_TIMEZONE": "Mars/Olympus"}, ValueError, "Invalid timezone"),
        ({"HYPEQUERY_MAX_CONCURRENT": 0}, ValueError, "between 1 and 128"),
    ],
)
def test_init_app_validates_config(
    built: Built, hq: Hypequery, config: dict[str, object], error: type[Exception], message: str
) -> None:
    with pytest.raises(error, match=message):
        _app(hq, **config)
    assert built.sync == []


def test_a_bad_loader_return_is_a_type_error(built: Built) -> None:
    hq = Hypequery()
    hq.tenant_loader(lambda: 42)  # type: ignore[type-var]
    app = _app(hq)
    with app.test_request_context("/"), pytest.raises(TypeError, match="tenant id"):
        _ = hq.client


def test_a_tenant_scope_from_the_loader_is_used(built: Built) -> None:
    from hypequery.datasets.planner import tenant

    hq = Hypequery()
    hq.tenant_loader(lambda: tenant("org_c"))
    app = _app(hq)
    with app.test_request_context("/"):
        assert isinstance(hq.client, TenantDatasetClient)


def test_mount_serve(built: Built, hq: Hypequery) -> None:
    async def serve_app(scope: MutableMapping[str, Any], receive: Any, send: Any) -> None:
        body = json.dumps({"root_path": scope["root_path"], "path": scope["path"]}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    app = _app(hq)
    hq.mount_serve(app, serve_app, prefix="/hq")
    client = app.test_client()
    assert json.loads(client.get("/hq/datasets/orders").get_data()) == {
        "root_path": "/hq",
        "path": "/hq/datasets/orders",
    }
    assert client.get("/orders").status_code == 403


def test_client_for_needs_no_app_context_and_does_not_connect(built: Built, hq: Hypequery) -> None:
    app = _app(hq)
    client = hq.client_for(app)
    assert built.sync == []
    with app.app_context():
        assert hq.base_client is client
    other = Flask("other")
    with pytest.raises(RuntimeError, match="not initialised"):
        hq.client_for(other)
