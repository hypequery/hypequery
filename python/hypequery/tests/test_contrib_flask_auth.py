"""`flask_session`: hypequery endpoints authenticated by a Flask app's own login.

With Flask-Login set up, the strategy reads ``current_user``; without it, the
``session``. Either way a signed-in page calls the endpoints with its session
cookie and no token, and the mapping runs on the request's own thread.
"""

from __future__ import annotations

import threading
from typing import Any

import pytest

pytest.importorskip("flask")

from flask import Flask, session
from pydantic import TypeAdapter

from core_transport import CoreClient
from hypequery.contrib.flask import blueprint, flask_session
from hypequery.serve import Api, Call, Principal, ServeResponse, create_api

SAME_ORIGIN = {"Sec-Fetch-Site": "same-origin"}


def _api(to_principal: Any, **options: Any) -> Api:
    async def whoami(call: Call) -> ServeResponse:
        assert call.auth is not None
        return ServeResponse.json({"subject": call.auth.principal.subject})

    api = create_api(auth=flask_session(to_principal, **options))
    api.add_route("GET", "/whoami", whoami)
    api.add_route("POST", "/whoami", whoami, input=TypeAdapter(dict[str, object]))
    return api


def _app(api: Api) -> Flask:
    app = Flask("hypequery_session_test")
    app.secret_key = "hypequery-tests"  # noqa: S105 - a test secret
    app.register_blueprint(blueprint(api), url_prefix="/api")
    return app


def test_the_session_is_read_when_flask_login_is_not_set_up() -> None:
    threads: list[int] = []

    def to_principal(current: Any) -> Principal | None:
        threads.append(threading.get_ident())
        user = current.get("user")
        return Principal(subject=user) if user else None

    app = _app(_api(to_principal))

    @app.post("/login")
    def login() -> str:
        session["user"] = "alice"
        return "ok"

    http = app.test_client()
    anonymous = http.get("/api/whoami")
    assert anonymous.status_code == 401
    assert anonymous.get_json()["error"]["details"] == {"reason": "missing_credentials"}
    http.post("/login")
    response = http.get("/api/whoami")
    assert response.status_code == 200
    assert response.get_json() == {"subject": "alice"}
    posted = http.post("/api/whoami", json={"x": 1}, headers=SAME_ORIGIN)
    assert posted.status_code == 200
    refused = http.post("/api/whoami", json={"x": 1})
    assert refused.status_code == 403
    assert refused.get_json()["error"]["details"] == {"reason": "cross_origin"}
    # On the request's own thread, inside its request context.
    assert set(threads) == {threading.get_ident()}


def test_current_user_is_read_when_flask_login_is_set_up() -> None:
    flask_login: Any = pytest.importorskip("flask_login")
    mixin: Any = flask_login.UserMixin

    class User(mixin):  # type: ignore[misc]
        def __init__(self, user_id: str) -> None:
            self.id = user_id

    seen: list[Any] = []

    def to_principal(user: Any) -> Principal:
        seen.append(user)
        return Principal(subject=user.get_id())

    app = _app(_api(to_principal))
    manager = flask_login.LoginManager(app)
    manager.user_loader(lambda user_id: User(user_id))

    @app.post("/login")
    def login() -> str:
        flask_login.login_user(User("bob"))
        return "ok"

    http = app.test_client()
    assert http.get("/api/whoami").status_code == 401
    # An anonymous user is refused without mapping it.
    assert seen == []
    http.post("/login")
    response = http.get("/api/whoami")
    assert response.status_code == 200
    assert response.get_json() == {"subject": "bob"}
    assert type(seen[0]) is User


def test_flask_session_serves_only_flask_requests_and_validates() -> None:
    assert CoreClient(_api(lambda current: None)).get("/whoami").status_code == 503
    with pytest.raises(TypeError, match="to_principal"):
        flask_session("not callable")  # type: ignore[arg-type]
    assert flask_session(lambda current: None, same_origin=False).same_origin is False
