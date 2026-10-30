"""`hypequery.contrib.flask.blueprint` under Flask-WTF's `CSRFProtect`."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("flask")
pytest.importorskip("flask_wtf")

from flask import Flask, session
from flask_wtf.csrf import CSRFProtect, generate_csrf
from pydantic import TypeAdapter

from hypequery.contrib.flask import blueprint, flask_session
from hypequery.serve import Api, Call, Credential, Principal, ServeResponse, create_api

BEARER = {"authorization": "Bearer reader"}
SAME_ORIGIN = {"sec-fetch-site": "same-origin"}


def _bearer(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


def _signed_in(state: Any) -> Principal | None:
    return Principal(subject="alice") if state.get("user") == "alice" else None


def _api(auth: Any) -> Api:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({"input": call.input})

    api = create_api(auth=auth)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(dict[str, object]))
    return api


def _app(register: Callable[[Flask], None], *, csrf_first: bool) -> Flask:
    app = Flask("hypequery_flask_csrf")
    app.secret_key = "hypequery-tests"  # noqa: S105 - a test secret
    csrf = CSRFProtect()
    if csrf_first:
        csrf.init_app(app)
    register(app)
    if not csrf_first:
        csrf.init_app(app)

    @app.post("/form")
    def form() -> Any:
        return {"ok": True}

    @app.get("/sign-in")
    def sign_in() -> Any:
        session["user"] = "alice"
        return {"token": generate_csrf()}

    return app


@pytest.mark.parametrize("csrf_first", [True, False])
def test_a_header_credential_api_is_exempt_and_the_app_stays_protected(csrf_first: bool) -> None:
    def register(app: Flask) -> None:
        app.register_blueprint(blueprint(_api(_bearer)), url_prefix="/agents")

    http = _app(register, csrf_first=csrf_first).test_client()
    response = http.post("/agents/echo", json={"x": 1}, headers=BEARER)
    assert response.status_code == 200
    assert response.get_json() == {"input": {"x": 1}}
    # The app's own forms are still checked.
    assert http.post("/form").status_code == 400


@pytest.mark.parametrize("csrf_first", [True, False])
def test_a_session_api_is_checked_and_accepts_the_token(csrf_first: bool) -> None:
    def register(app: Flask) -> None:
        app.register_blueprint(blueprint(_api(flask_session(_signed_in))), url_prefix="/api")

    http = _app(register, csrf_first=csrf_first).test_client()
    token = http.get("/sign-in").get_json()["token"]
    refused = http.post("/api/echo", json={"x": 1}, headers=SAME_ORIGIN)
    assert refused.status_code == 400
    accepted = http.post("/api/echo", json={"x": 1}, headers={**SAME_ORIGIN, "X-CSRFToken": token})
    assert accepted.status_code == 200
    assert accepted.get_json() == {"input": {"x": 1}}


def test_both_blueprints_on_one_app_keep_their_own_rules() -> None:
    def register(app: Flask) -> None:
        app.register_blueprint(blueprint(_api(_bearer), name="agents"), url_prefix="/agents")
        app.register_blueprint(blueprint(_api(flask_session(_signed_in))), url_prefix="/api")

    http = _app(register, csrf_first=True).test_client()
    http.get("/sign-in")
    assert http.post("/agents/echo", json={}, headers=BEARER).status_code == 200
    assert http.post("/api/echo", json={}, headers=SAME_ORIGIN).status_code == 400


def test_without_flask_wtf_the_blueprint_registers_no_hook_that_fails() -> None:
    app = Flask("no_csrf")
    app.register_blueprint(blueprint(_api(_bearer)), url_prefix="/agents")
    response = app.test_client().post("/agents/echo", json={"x": 1}, headers=BEARER)
    assert response.status_code == 200
