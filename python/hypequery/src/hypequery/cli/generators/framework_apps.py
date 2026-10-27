"""The application files `init --framework django|flask` writes instead of a FastAPI app.

Both use the framework integrations in ``hypequery.contrib`` and the generated
``datasets.py``. Their tenant function returns None until the user wires it to
their login, so datasets with a ``tenant_key`` refuse to run rather than read
every tenant.
"""

from __future__ import annotations

from typing import Literal, TypeAlias

Framework: TypeAlias = Literal["fastapi", "django", "flask"]
FRAMEWORKS: tuple[Framework, ...] = ("fastapi", "django", "flask")

#: The pyproject extras each framework needs; each includes the ClickHouse driver.
EXTRAS: dict[Framework, str] = {
    "fastapi": "fastapi,clickhouse",
    "django": "django",
    "flask": "flask",
}

#: The module the scaffold writes for each framework, beside datasets.py.
APP_MODULE: dict[Framework, str] = {"fastapi": "app", "django": "analytics", "flask": "app"}

#: What `init` tells the user to run next.
RUN_COMMAND: dict[Framework, str] = {
    "fastapi": "hypequery dev",
    # Django's scaffold is files for an existing project, not a project to run.
    "django": "",
    "flask": "flask --app app run --port 5001",
}


def _tenant_hint(tenant_column: str | None) -> str:
    if tenant_column is None:
        return "    # Datasets have no tenant_key yet; see the README to scope them by tenant.\n"
    return (
        f"    # Datasets are scoped by {tenant_column!r}: return the signed-in user's\n"
        f"    # {tenant_column} value.\n"
    )


def django_module(tenant_column: str | None) -> str:
    return f'''"""hypequery for Django: the registry, the tenant function and an example view.

Add to settings.py:

    INSTALLED_APPS = [..., "hypequery.contrib.django"]
    MIDDLEWARE = [
        ...,
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "hypequery.contrib.django.HypequeryMiddleware",
    ]
    HYPEQUERY = {{"REGISTRY": "analytics.registry", "TENANT": "analytics.tenant_for_request"}}

and to urls.py:

    import analytics

    urlpatterns = [..., path("analytics/<str:dataset>", analytics.dataset_summary)]

The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
"""

from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, JsonResponse

from datasets import datasets
from hypequery.datasets import CompiledQueryError, create_dataset_registry

registry = create_dataset_registry(*datasets.values())


def tenant_for_request(request: HttpRequest) -> str | None:
    """The tenant to scope this request to, or None.

    None leaves datasets with a tenant_key unqueryable, which is the safe default
    until this reads your login, e.g. ``request.user.organization_id``.
    """

{_tenant_hint(tenant_column)}    return None


@login_required
def dataset_summary(request: HttpRequest, dataset: str) -> JsonResponse:
    """Every base measure of *dataset*, scoped to the signed-in user's tenant."""

    if dataset not in datasets:
        return JsonResponse({{"error": "unknown dataset"}}, status=404)
    try:
        result = request.analytics.execute(dataset, {{"limit": 100}})
    except CompiledQueryError as error:
        status = 403 if error.category == "tenant-required" else 400
        return JsonResponse({{"error": error.category}}, status=status)
    return JsonResponse({{"data": list(result.data)}})
'''


def flask_module(tenant_column: str | None) -> str:
    return f'''"""A Flask app using hypequery's extension and the generated datasets.

Run: flask --app app run --port 5001   (macOS's AirPlay receiver holds port 5000)

The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
"""

from typing import Any

from flask import Flask

from datasets import datasets
from hypequery.contrib.flask import Hypequery
from hypequery.datasets import CompiledQueryError, create_dataset_registry

registry = create_dataset_registry(*datasets.values())
hq = Hypequery()


def signed_in() -> bool:
    """Whether the request comes from a signed-in user.

    False until this reads your login, e.g. Flask-Login's
    ``current_user.is_authenticated``, so every analytics route answers 401
    rather than serving data to anonymous callers. Tenant scoping is not a
    login check: a dataset without a tenant_key answers anyone it reaches.
    """

    return False


@hq.tenant_loader
def current_tenant() -> str | None:
    """The tenant to scope this request to, or None.

    None leaves datasets with a tenant_key unqueryable, which is the safe default
    until this reads your login, e.g. Flask-Login's ``current_user.org_id``.
    """

{_tenant_hint(tenant_column)}    return None


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["HYPEQUERY_REGISTRY"] = registry
    hq.init_app(app)

    @app.get("/analytics/<dataset>")
    def dataset_summary(dataset: str) -> Any:
        """Every base measure of *dataset*, scoped to the request's tenant."""

        if not signed_in():
            return {{"error": "sign in first"}}, 401
        if dataset not in datasets:
            return {{"error": "unknown dataset"}}, 404
        try:
            result = hq.client.execute(dataset, {{"limit": 100}})
        except CompiledQueryError as error:
            status = 403 if error.category == "tenant-required" else 400
            return {{"error": error.category}}, status
        return {{"data": list(result.data)}}

    return app


app = create_app()
'''


def readme_section(framework: Framework, first_dataset: str) -> str:
    """The README section that replaces "Run and query" for a framework scaffold."""

    if framework == "django":
        return f"""## Use it from Django

`analytics.py` is written to sit beside your Django project's apps. Add
`datasets.py` and `analytics.py` to the project, then add the settings and URL in
`analytics.py`'s docstring. Wire `tenant_for_request` to your login before
querying tenant-scoped datasets: it returns `None` until you do, and those
datasets refuse to run.

```bash
python manage.py check   # validates HYPEQUERY without connecting
python manage.py runserver
```

Signed in, open `/analytics/{first_dataset}`. Views use `request.analytics`, a client
already scoped to the user's tenant; async views get the async client.
"""
    return f"""## Run with Flask

```bash
flask --app app run --port 5001
```

Port 5001, because macOS's AirPlay receiver holds 5000. Open
<http://127.0.0.1:5001/analytics/{first_dataset}>. Routes use `hq.client`, already
scoped to the tenant `current_tenant` returns. Wire `signed_in` and `current_tenant`
to your login first: until then every route answers 401, and tenant-scoped datasets
also refuse to run without a tenant.
"""
