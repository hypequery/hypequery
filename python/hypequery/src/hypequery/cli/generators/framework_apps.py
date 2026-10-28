"""The application `init --framework` writes beside datasets.py.

- ``standalone`` (the default): ``app.py``, an API from ``create_api`` served
  as plain ASGI by ``hypequery dev``, with no web framework;
- ``django``: a small runnable Django project (``settings.py``, ``urls.py``,
  ``manage.py``) whose ``analytics.py`` holds what hypequery needs;
- ``flask``: a Flask ``app.py``.

The Django and Flask apps serve hypequery's endpoints natively (``urls(api)``,
``blueprint(api)``) twice: behind the framework's own login with the
same-origin check, for ``@hypequery/react``, and behind a bearer token, for
``@hypequery/mcp``. Their login mappings refuse tenant-scoped data until the
user wires them, rather than reading every tenant.
"""

from __future__ import annotations

import re
import secrets
from importlib.resources import files
from typing import Literal, TypeAlias

Framework: TypeAlias = Literal["standalone", "django", "flask"]
FRAMEWORKS: tuple[Framework, ...] = ("standalone", "django", "flask")

#: The pyproject extras each framework needs; each includes the ClickHouse driver.
EXTRAS: dict[Framework, str] = {
    "standalone": "server,clickhouse",
    "django": "django",
    "flask": "flask",
}

#: The application files each framework writes, beside datasets.py.
FILES: dict[Framework, tuple[str, ...]] = {
    "standalone": ("app.py",),
    "django": ("analytics.py", "urls.py", "settings.py", "manage.py"),
    "flask": ("app.py",),
}

#: The modules the generated pyproject installs.
MODULES: dict[Framework, tuple[str, ...]] = {
    "standalone": ("app", "datasets"),
    "django": ("analytics", "datasets"),
    "flask": ("app", "datasets"),
}

#: What `init` tells the user to run next.
RUN_COMMAND: dict[Framework, str] = {
    "standalone": "hypequery dev",
    "django": "python manage.py migrate && python manage.py runserver",
    "flask": "flask --app app run --port 5001",
}

_PLACEHOLDER = "    # __TENANT_HINT__\n"


def _tenant_hint(framework: Framework, tenant_column: str | None) -> str:
    if tenant_column is None:
        return "    # Datasets have no tenant_key yet; see the README to scope them by tenant.\n"
    target = "return" if framework == "django" else "set tenant_id to"
    return (
        f"    # Datasets are scoped by {tenant_column!r}: {target} the signed-in user's\n"
        f"    # {tenant_column} value.\n"
    )


def framework_files(framework: Framework, tenant_column: str | None) -> dict[str, str]:
    """The application files for *framework*; standalone's app.py is a base template."""

    if framework == "standalone":
        return {}
    root = files("hypequery.cli").joinpath("templates", framework)
    result = {name: root.joinpath(name).read_text(encoding="utf-8") for name in FILES[framework]}
    module = "analytics.py" if framework == "django" else "app.py"
    if _PLACEHOLDER not in result[module]:
        raise ValueError(f"{framework} template no longer has the tenant hint placeholder")
    result[module] = result[module].replace(_PLACEHOLDER, _tenant_hint(framework, tenant_column))
    if framework == "django":
        # A development key per project, as `django-admin startproject` writes.
        result["settings.py"] = result["settings.py"].replace(
            "__DJANGO_SECRET_KEY__", secrets.token_urlsafe(40)
        )
    return result


def apply_framework(
    templates: dict[str, str], framework: Framework, tenant_column: str | None
) -> dict[str, str]:
    """*templates* with *framework*'s application, extras, modules and settings."""

    if framework == "standalone":
        return templates.copy()
    result = templates.copy()
    modules = ", ".join(f'"{module}"' for module in MODULES[framework])
    result["pyproject.toml"] = (
        templates["pyproject.toml"]
        .replace('py-modules = ["app", "datasets"]', f"py-modules = [{modules}]")
        .replace("hypequery[server,clickhouse]", f"hypequery[{EXTRAS[framework]}]")
    )
    result.pop("app.py")
    result.update(framework_files(framework, tenant_column))
    secret = "DJANGO_SECRET_KEY" if framework == "django" else "FLASK_SECRET_KEY"
    result[".env.example"] = (
        templates[".env.example"]
        + f"# Signs sessions; the development fallback is not for deployment.\n{secret}=\n"
    )
    if framework == "django":
        result[".gitignore"] = templates[".gitignore"] + "db.sqlite3\n"
    return result


def offline_templates(templates: dict[str, str], framework: Framework) -> dict[str, str]:
    """The offline orders example for *framework*, querying the seed's table."""

    result = apply_framework(templates, framework, None)
    if framework == "standalone":
        return result
    prefix, serve = templates["README.md"].split("## Serve and query", 1)
    payload = re.search(r"-d '([^']+)'", serve)
    response = re.search(r"```json\n(.*?)\n```", serve, re.S)
    if payload is None or response is None:
        raise ValueError("README template no longer has the example query and response")
    result["README.md"] = with_extras(prefix, framework) + readme_section(
        framework, "orders", payload[1], tenant_column=None, response=response[1]
    )
    return result


def with_extras(readme: str, framework: Framework) -> str:
    template = "[server,clickhouse]"
    if template not in readme:
        raise ValueError("README template no longer names the standalone extras")
    return readme.replace(template, f"[{EXTRAS[framework]}]")


AGENTS_FOR = "`@hypequery/mcp`, scripts, curl"


def _endpoints_row(prefix: str, authenticated_by: str, purpose: str) -> str:
    endpoints = f"`POST /api/{prefix}/<dataset>`, `GET /api/{prefix}/client-contract`"
    return f"| {endpoints} | {authenticated_by} | {purpose} |"


def readme_section(
    framework: Framework,
    dataset: str,
    payload: str,
    *,
    tenant_column: str | None,
    response: str | None = None,
) -> str:
    """The README section on running a Django or Flask scaffold and querying it.

    *payload* is the example query's JSON body, and *response* the answer the
    offline example's seed data gives it.
    """

    django = framework == "django"
    base = "http://127.0.0.1:8000" if django else "http://127.0.0.1:5001"
    run = (
        """`settings.py`, `urls.py` and `manage.py` are a small Django project you can run
as it is; `analytics.py` holds what hypequery needs. Users and sessions live in
`db.sqlite3`.

```bash
python manage.py migrate
python manage.py createsuperuser   # a user to sign in as, at /admin/
python manage.py runserver
```
"""
        if django
        else """```bash
flask --app app run --port 5001
```

Port 5001, because macOS's AirPlay receiver holds 5000.
"""
    )
    login = "Django's login (`django_user`)" if django else "The app's login (`flask_session`)"
    session = (
        "takes the session of a user signed in at `/admin/`, with no token. "
        "Django's CSRF middleware also checks it: send the `csrftoken` cookie's value "
        "as an `X-CSRFToken` header."
        if django
        else "takes the app's session (or Flask-Login's `current_user`), with no token."
    )
    own = (
        "`/analytics/<dataset>` is a view of your own, querying through `request.analytics`."
        if django
        else "`/analytics/<dataset>` is a route of your own, querying through `hq.client`."
    )
    wire = (
        "`tenant_of` in `analytics.py` returns `None` until you wire it to your user model, "
        "so datasets with a `tenant_key` refuse to run for signed-in users"
        if django
        else "`principal_for_session` in `app.py` returns `None` until you wire it to your "
        "login, so the session API and `/analytics` refuse everyone; give its principal "
        "the user's `tenant_id`"
    )
    module = "analytics.py" if django else "app.py"
    scoped = (
        f"The datasets are scoped by `{tenant_column}`, and the token's principal has no "
        "tenant, so the token API refuses them until `principal_for_token` gives one.\n\n"
        if tenant_column
        else ""
    )
    answer = f"\n```json\n{response}\n```\n" if response else ""
    existing = (
        """
To use an existing Django project instead, copy `datasets.py` and `analytics.py`
into it, the `api/` entries of `urls.py` into your URLconf, and the lines of
`settings.py` marked "hypequery" into your settings.
"""
        if django
        else ""
    )
    deploy = (
        "set `DJANGO_SECRET_KEY`, `DEBUG = False` and your `ALLOWED_HOSTS` in `settings.py`"
        if django
        else "set `FLASK_SECRET_KEY` and add your domain to `SECURITY`'s allowed hosts"
    )
    return f"""## Run with {"Django" if django else "Flask"}

{run}
hypequery's endpoints are served by the app itself, twice:

| Endpoints | Authenticated by | For |
| --- | --- | --- |
{_endpoints_row("agents", "`Authorization: Bearer $HYPEQUERY_DEV_TOKEN`", AGENTS_FOR)}
{_endpoints_row("analytics", login, "`@hypequery/react` on pages the app serves")}

From another shell with `HYPEQUERY_DEV_TOKEN` set:

```bash
curl --fail-with-body -s {base}/api/agents/{dataset} \\
  -H "Authorization: Bearer $HYPEQUERY_DEV_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{payload}'
```
{answer}
{scoped}A request without the token returns `401`. Measure values are strings on the
HTTP wire.

**The session API** {session} It refuses a cross-site request with `403`
(the same-origin check); a browser marks its own page's requests
`Sec-Fetch-Site: same-origin`. {own}

**Before real users:**

- {wire};
- replace `principal_for_token` in `{module}` with your own credential check, or
  `jwt_strategy` from the `jwt` extra (`pip install "hypequery[jwt]"`);
- {deploy}.
{existing}"""
