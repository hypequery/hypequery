"""Run: python -m examples.django_app runserver (from python/hypequery).

Needs ``hypequery[django]``. Seed examples/seed.sql; set CLICKHOUSE_URL
(or the CLICKHOUSE_* variables), HYPEQUERY_TENANT_A_TOKEN and
HYPEQUERY_TENANT_B_TOKEN. Then open http://localhost:8000/, a React page
served by the project, and sign in with a tenant token: the page calls
hypequery's endpoints with its Django session and no token.

The project serves hypequery's own endpoints natively from its URLconf
(``examples/django_urls.py``): at ``/api/analytics`` behind the project's own
login (``django_user``), for ``@hypequery/react`` on the same origin, and at
``/api/agents`` behind a bearer token, for ``@hypequery/mcp`` and scripts::

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" \
      -H "Content-Type: application/json" -d '{"measures": ["revenue"]}' \
      localhost:8000/api/agents/orders

The project's own views take either the session or the token::

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" localhost:8000/revenue

Under gunicorn (WSGI)::

    gunicorn "examples.django_app:wsgi_application()" --threads 8

or uvicorn (ASGI): ``uvicorn "examples.django_app:asgi_application" --factory``.
Both serve the same views; see ``examples/README.md`` for React and MCP.

A single-file Django project. In a real project the ``SETTINGS`` below live in
settings.py, the views in views.py, the URLconf in urls.py, and the
applications in wsgi.py and asgi.py. Its users and sessions live in a SQLite
file (``HYPEQUERY_EXAMPLE_DATABASE``, by default in the temporary directory),
migrated when the project starts.
"""

from __future__ import annotations

import os
import sys
import tempfile
from typing import Any

from django.conf import settings
from django.contrib.auth import login, logout
from django.http import HttpRequest, HttpResponse, HttpResponseNotAllowed, JsonResponse
from django.middleware.csrf import get_token

from hypequery.serve import Principal

from .utils.analytics import PAGE, principal_for_organization
from .utils.orders import organization_for, organization_for_token

#: Each organization signs in as one Django user of this name.
_USER_PREFIX = "org-"

SETTINGS: dict[str, Any] = {
    "DEBUG": True,
    "SECRET_KEY": "example-only-not-secret",
    "ALLOWED_HOSTS": ["localhost", "127.0.0.1", "testserver"],
    "ROOT_URLCONF": "examples.django_urls",
    "INSTALLED_APPS": [
        "django.contrib.auth",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "hypequery.contrib.django",
    ],
    "DATABASES": {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get("HYPEQUERY_EXAMPLE_DATABASE")
            or os.path.join(tempfile.gettempdir(), "hypequery-django-example.sqlite3"),
        }
    },
    "MIDDLEWARE": [
        "django.contrib.sessions.middleware.SessionMiddleware",
        # Checks the session-authenticated API's unsafe requests (the page
        # sends X-CSRFToken); the bearer-token API is exempt.
        "django.middleware.csrf.CsrfViewMiddleware",
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "hypequery.contrib.django.HypequeryMiddleware",
    ],
    "HYPEQUERY": {
        "URL": None,  # read CLICKHOUSE_URL or CLICKHOUSE_* from the environment
        "REGISTRY": "examples.utils.orders.registry",
        "TENANT": f"{__name__}.tenant_for_request",
    },
}


def organization_of(user: Any) -> str | None:
    """A signed-in user's organization; in a real app, a field on the user."""

    if not user.is_authenticated or not user.username.startswith(_USER_PREFIX):
        return None
    return str(user.username.removeprefix(_USER_PREFIX))


def principal_for_user(user: Any) -> Principal | None:
    """``django_user``'s mapping: the signed-in user to its principal and tenant."""

    return principal_for_organization(organization_of(user))


def tenant_for_request(request: HttpRequest) -> str | None:
    """The signed-in user's organization, else the bearer token's."""

    return organization_of(request.user) or organization_for(request.headers.get("Authorization"))


def page(request: HttpRequest) -> HttpResponse:
    """The same-origin React page."""

    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    # Sets the `csrftoken` cookie the page sends back as X-CSRFToken.
    get_token(request)
    return HttpResponse(PAGE, content_type="text/html; charset=utf-8")


def sign_in(request: HttpRequest) -> HttpResponse:
    """The stand-in login: an organization's token signs in its user."""

    from django.contrib.auth.models import User

    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    organization = organization_for_token(request.POST.get("token", ""))
    if organization is None:
        return HttpResponse(status=401)
    user, _ = User.objects.get_or_create(username=_USER_PREFIX + organization)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponse(status=204)


def sign_out(request: HttpRequest) -> HttpResponse:
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    logout(request)
    return HttpResponse(status=204)


def revenue(request: HttpRequest) -> JsonResponse:
    """Revenue by country for the caller's organization only."""

    if tenant_for_request(request) is None:
        return JsonResponse({"error": "sign in first"}, status=401)
    result = request.analytics.execute(
        "orders", {"dimensions": ["country"], "measures": ["revenue", "orderCount"]}
    )
    return JsonResponse({"data": list(result.data)})


async def revenue_by_day(request: HttpRequest) -> JsonResponse:
    """The same middleware hands async views the async client."""

    if tenant_for_request(request) is None:
        return JsonResponse({"error": "sign in first"}, status=401)
    result = await request.analytics.execute("orders", {"measures": ["revenue"], "by": "day"})
    return JsonResponse({"data": list(result.data)})


def configure() -> None:
    """Apply ``SETTINGS`` once per process, then set Django up."""

    if not settings.configured:
        import django
        from django.core.management import call_command

        settings.configure(**SETTINGS)
        django.setup()
        call_command("migrate", verbosity=0, interactive=False)


def wsgi_application() -> Any:
    """The project as a WSGI app, for gunicorn or waitress."""

    configure()
    from django.core.wsgi import get_wsgi_application

    return get_wsgi_application()


def asgi_application() -> Any:
    """The same project as an ASGI app, so async views share one event loop.

    Run with: uvicorn "examples.django_app:asgi_application" --factory
    """

    configure()
    from django.core.asgi import get_asgi_application

    return get_asgi_application()


if __name__ == "__main__":
    configure()
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
