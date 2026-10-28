"""A Flask app serving hypequery's endpoints, and a route of your own.

Run: flask --app app run --port 5001   (macOS's AirPlay receiver holds port 5000)

hypequery's endpoints are mounted twice: at /api/analytics behind the app's
own login, for `@hypequery/react` on pages it serves, and at /api/agents
behind a bearer token, for `@hypequery/mcp` and scripts.
The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
"""

import os
import secrets
from typing import Any

from datasets import datasets
from flask import Flask, session

from hypequery.contrib.flask import Hypequery, blueprint, flask_session
from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQueryError,
    DatasetClient,
    create_dataset_registry,
)
from hypequery.serve import (
    Api,
    Authenticator,
    ContextStrategy,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)

registry = create_dataset_registry(*datasets.values())
hq = Hypequery()
#: For local development only: see principal_for_token.
DEV_TOKEN = os.environ.get("HYPEQUERY_DEV_TOKEN", "")
#: The tenant the token reads, for datasets with a tenant_key; unset, it reads none of them.
DEV_TENANT = os.environ.get("HYPEQUERY_DEV_TENANT") or None
#: Add your domain before deploying: a request for any other Host is refused.
SECURITY = HttpSecurity(allowed_hosts=("127.0.0.1", "localhost"))


def principal_for_session(current: Any) -> Principal | None:
    """Who the signed-in user queries as, or None to answer 401.

    *current* is the session, or Flask-Login's ``current_user`` once the app
    sets Flask-Login up. None until this reads your login, so the session API
    and /analytics refuse everyone; for example
    ``Principal(subject=user.get_id(), tenant_id=user.org_id)``.
    """

    # __TENANT_HINT__
    return None


def principal_for_token(credential: Credential) -> Principal | None:
    """Who a bearer token queries as, for `@hypequery/mcp`, scripts and curl.

    Accepts HYPEQUERY_DEV_TOKEN, and no token when it is unset. Replace this
    with your own credential check, or ``jwt_strategy`` from the ``jwt``
    extra, before production. Its principal's tenant is HYPEQUERY_DEV_TENANT;
    without one, datasets with a tenant_key refuse it.
    """

    if DEV_TOKEN and secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer", tenant_id=DEV_TENANT)
    return None


@hq.tenant_loader
def current_tenant() -> str | None:
    """The tenant ``hq.client`` is scoped to in your own routes."""

    # With Flask-Login, pass current_user here as flask_session does.
    principal = principal_for_session(session)
    return principal.tenant_id if principal else None


def analytics_api(client: DatasetClient, *, auth: Authenticator | ContextStrategy) -> Api:
    """``POST /<dataset>`` for every dataset, and ``GET /client-contract``.

    The client contract is what typed `@hypequery/react` clients pin and the
    MCP bridge discovers.
    """

    api = create_api(auth=auth, security=SECURITY)
    for name, definition in datasets.items():
        add_dataset_endpoint(
            api,
            f"/{name}",
            dataset=definition,
            client=client,
            client_profile=ClientQueryProfile(),
            # A tenant-scoped dataset needs a principal with a tenant, and is left
            # out of the client contract of one without.
            policy=EndpointPolicy(tenant="required" if definition.tenant_key else "optional"),
        )
    add_client_contract_endpoint(api)
    return api


def create_app() -> Flask:
    app = Flask(__name__)
    # Signs the session cookie; set FLASK_SECRET_KEY to keep sessions across restarts.
    app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["HYPEQUERY_REGISTRY"] = registry
    hq.init_app(app)
    # The process client connects on the first query, not here.
    client = hq.client_for(app)
    # The app's own login, with the same-origin check: Flask has no CSRF middleware.
    session_api = analytics_api(client, auth=flask_session(principal_for_session))
    app.register_blueprint(blueprint(session_api), url_prefix="/api/analytics")
    agents_api = analytics_api(client, auth=principal_for_token)
    app.register_blueprint(blueprint(agents_api, name="agents"), url_prefix="/api/agents")

    @app.get("/analytics/<dataset>")
    def dataset_summary(dataset: str) -> Any:
        """A route of your own: every base measure of *dataset*, for the user's tenant."""

        if principal_for_session(session) is None:
            return {"error": "sign in first"}, 401
        if dataset not in datasets:
            return {"error": "unknown dataset"}, 404
        try:
            result = hq.client.execute(dataset, {"limit": 100})
        except CompiledQueryError as error:
            status = 403 if error.category == "tenant-required" else 400
            return {"error": error.category}, status
        return {"data": list(result.data)}

    return app


app = create_app()
