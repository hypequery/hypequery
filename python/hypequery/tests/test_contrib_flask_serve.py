"""`hypequery.contrib.flask.blueprint`: prefixes, bodies, request context, test client."""

from __future__ import annotations

import io
from typing import Any

import pytest

pytest.importorskip("flask")

import flask
from flask import Flask
from pydantic import TypeAdapter

from hypequery.contrib.flask import blueprint
from hypequery.serve import (
    Api,
    Call,
    Credential,
    Principal,
    ServeResponse,
    create_api,
)
from wsgi_client import call, environ

AUTH = {"authorization": "Bearer reader"}


def _authenticate(credential: Credential) -> Principal | None:
    # Host code runs inside the request's own Flask context.
    assert flask.request.path.endswith(("/echo", "/context"))
    return Principal(subject="reader") if credential.value == "reader" else None


def _api(**options: Any) -> Api:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({"input": call.input})

    async def context(call: Call) -> ServeResponse:
        return ServeResponse.json(
            {
                "same": call.request.raw is flask.request._get_current_object(),  # type: ignore[attr-defined]
                "g": flask.g.get("marker"),
                "app": flask.current_app.name,
            }
        )

    api = create_api(auth=_authenticate, **options)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    api.add_route("GET", "/context", context)
    return api


def _app(api: Api, **config: Any) -> Flask:
    app = Flask("hypequery_flask_serve")
    app.config.update(config)

    @app.before_request
    def mark() -> None:
        flask.g.marker = "set before the request"

    @app.get("/own")
    def own() -> Any:
        return {"own": True}

    app.register_blueprint(blueprint(api, url_prefix="/analytics"))
    return app


def test_blueprint_checks_its_argument_and_the_client_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(TypeError, match="create_api"):
        blueprint(object())  # type: ignore[arg-type]
    api = _api()
    checked: list[Api] = []
    monkeypatch.setattr(
        "hypequery.contrib.flask.export_client_contract", lambda api: checked.append(api)
    )
    blueprint(api)
    assert checked == []
    monkeypatch.setattr(type(api.client_endpoints), "bindings", property(lambda self: (object(),)))
    blueprint(api)
    assert checked == [api]


def test_the_flask_test_client_reaches_the_api_and_the_app_keeps_its_routes() -> None:
    http = _app(_api()).test_client()
    response = http.post("/analytics/echo", json={"x": 1}, headers=AUTH)
    assert response.status_code == 200
    assert response.get_json() == {"input": {"x": 1}}
    assert http.get("/own").get_json() == {"own": True}
    assert http.get("/analytics/own", headers=AUTH).status_code == 404


def test_host_code_runs_in_the_request_context() -> None:
    body = _app(_api()).test_client().get("/analytics/context", headers=AUTH).get_json()
    assert body == {"same": True, "g": "set before the request", "app": "hypequery_flask_serve"}


def test_a_body_over_max_content_length_is_refused_as_too_large() -> None:
    http = _app(_api(), MAX_CONTENT_LENGTH=100).test_client()
    response = http.post("/analytics/echo", json={"x": "y" * 500}, headers=AUTH)
    assert response.status_code == 413
    assert response.get_json()["error"]["type"] == "PAYLOAD_TOO_LARGE"


def test_a_chunked_body_the_server_framed_is_read_to_its_end() -> None:
    built = environ(
        "POST",
        "/analytics/echo",
        headers=[
            ("host", "testserver"),
            ("authorization", "Bearer reader"),
            ("content-type", "application/json"),
            ("transfer-encoding", "chunked"),
        ],
        input_stream=io.BytesIO(b'{"x": 2}'),
    )
    built["wsgi.input_terminated"] = True
    response = call(_app(_api()), built)
    assert response.status_code == 200
    assert response.json() == {"input": {"x": 2}}


def test_a_core_response_without_a_content_type_gets_none_from_flask() -> None:
    async def empty(call: Call) -> ServeResponse:
        return ServeResponse(status=200, headers={}, body=b"")

    api = create_api(auth=_authenticate)
    api.add_route("GET", "/empty", empty, public=True)
    app = Flask("empty")
    app.register_blueprint(blueprint(api, name="analytics"))
    response = app.test_client().get("/empty")
    assert response.status_code == 200
    assert "Content-Type" not in response.headers


def test_a_body_a_hook_already_read_is_still_served() -> None:
    app = _app(_api(), MAX_CONTENT_LENGTH=1000)

    @app.before_request
    def inspect() -> None:
        if flask.request.is_json:
            assert flask.request.get_json()["x"] == 3

    response = app.test_client().post("/analytics/echo", json={"x": 3}, headers=AUTH)
    assert response.status_code == 200, response.get_data()
    assert response.get_json() == {"input": {"x": 3}}


def test_any_method_below_the_prefix_reaches_the_core_and_none_outside_it() -> None:
    http = _app(_api()).test_client()
    for method in ("TRACE", "PROPFIND"):
        below = http.open("/analytics/echo", method=method, headers=AUTH)
        assert below.status_code == 404
        assert below.get_json()["error"]["type"] == "NOT_FOUND"
    # The app's own routes keep Flask's method handling.
    assert http.open("/own", method="TRACE").status_code == 405
