"""Run: python -m examples.flask_app (from python/hypequery).

Needs ``hypequery[flask]``. Seed examples/seed.sql; set CLICKHOUSE_URL
(or the CLICKHOUSE_* variables), HYPEQUERY_TENANT_A_TOKEN and
HYPEQUERY_TENANT_B_TOKEN, and FLASK_SECRET_KEY to keep sessions across
restarts. Then open http://localhost:5001/, a React page served by the app,
and sign in with a tenant token: the page calls hypequery's endpoints with its
Flask session and no token.

The app serves hypequery's own endpoints natively as blueprints: at
``/api/analytics`` behind the app's own login (``flask_session``), for
``@hypequery/react`` on the same origin, and at ``/api/agents`` behind a bearer
token, for ``@hypequery/mcp`` and scripts::

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" \
      -H "Content-Type: application/json" -d '{"measures": ["revenue"]}' \
      localhost:5001/api/agents/orders

The app's own routes take either the session or the token::

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" localhost:5001/revenue

Run it with ``flask --app examples.flask_app run --port 5001`` or gunicorn:
``gunicorn "examples.flask_app:create_app()" --threads 8``. See
``examples/README.md`` for React and MCP.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Mapping
from typing import Any

from flask import Flask, Response, abort, request, session

from hypequery.contrib.flask import Hypequery, blueprint, flask_session
from hypequery.serve import Principal

from .utils.analytics import (
    AGENT_MOUNT_PATH,
    MOUNT_PATH,
    PAGE,
    analytics_api,
    principal_for,
    principal_for_organization,
)
from .utils.orders import organization_for, organization_for_token

hq = Hypequery()


def principal_for_session(current: Mapping[str, Any]) -> Principal | None:
    """``flask_session``'s mapping. With Flask-Login it receives ``current_user``."""

    return principal_for_organization(current.get("organization"))


@hq.tenant_loader
def current_tenant() -> str | None:
    """The signed-in organization, else the bearer token's."""

    signed_in: str | None = session.get("organization")
    return signed_in or organization_for(request.headers.get("Authorization"))


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    # HYPEQUERY_URL is unset, so the connection comes from CLICKHOUSE_URL or CLICKHOUSE_*.
    app.config["HYPEQUERY_REGISTRY"] = "examples.utils.orders:registry"
    hq.init_app(app)
    # POST .../orders and GET .../client-contract under each prefix. The
    # process client connects on the first query, not here.
    client = hq.client_for(app)
    # For the React page: the app's own login, with no token.
    session_api = analytics_api(client, auth=flask_session(principal_for_session))
    app.register_blueprint(blueprint(session_api), url_prefix=MOUNT_PATH)
    # For the MCP bridge and scripts: a bearer token.
    agents = analytics_api(client, auth=principal_for)
    app.register_blueprint(blueprint(agents, name="agents"), url_prefix=AGENT_MOUNT_PATH)

    @app.get("/")
    def page() -> Response:
        return Response(PAGE, content_type="text/html; charset=utf-8")

    @app.post("/login")
    def sign_in() -> Response:
        """The stand-in login: an organization's token signs in its session."""

        # Flask has no CSRF protection of its own: accept sign-ins from this
        # origin's page only, as the API's same-origin check does.
        if request.headers.get("Sec-Fetch-Site") not in ("same-origin", None):
            abort(403)
        organization = organization_for_token(request.form.get("token", ""))
        if organization is None:
            abort(401)
        session.clear()
        session["organization"] = organization
        return Response(status=204)

    @app.post("/logout")
    def sign_out() -> Response:
        session.clear()
        return Response(status=204)

    @app.get("/revenue")
    def revenue() -> Any:
        """Revenue by country for the caller's organization only."""

        if current_tenant() is None:
            abort(401)
        result = hq.client.execute(
            "orders", {"dimensions": ["country"], "measures": ["revenue", "orderCount"]}
        )
        return {"data": list(result.data)}

    @app.get("/revenue/daily")
    async def revenue_by_day() -> Any:
        if current_tenant() is None:
            abort(401)
        result = await hq.async_client.execute("orders", {"measures": ["revenue"], "by": "day"})
        return {"data": list(result.data)}

    return app


if __name__ == "__main__":
    # 5001, not Flask's default 5000: macOS's AirPlay receiver listens on 5000.
    create_app().run(port=5001)
