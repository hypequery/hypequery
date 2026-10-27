"""Run: python -m examples.django_app runserver (from python/hypequery).

Needs ``hypequery[django,fastapi]``. Seed examples/seed.sql; set CLICKHOUSE_URL
(or the CLICKHOUSE_* variables), HYPEQUERY_TENANT_A_TOKEN and
HYPEQUERY_TENANT_B_TOKEN. Then:

    curl -H "Authorization: Bearer $HYPEQUERY_TENANT_A_TOKEN" localhost:8000/revenue

A single-file Django project. In a real project the ``SETTINGS`` below live in
settings.py, the views in views.py, and ``asgi_application`` in asgi.py.
"""

from __future__ import annotations

import sys
from typing import Any

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.urls import path

from .utils.orders import organization_for

SETTINGS: dict[str, Any] = {
    "DEBUG": True,
    "SECRET_KEY": "example-only-not-secret",
    "ALLOWED_HOSTS": ["localhost", "127.0.0.1", "testserver"],
    "ROOT_URLCONF": __name__,
    "INSTALLED_APPS": ["hypequery.contrib.django"],
    "MIDDLEWARE": ["hypequery.contrib.django.HypequeryMiddleware"],
    "HYPEQUERY": {
        "URL": None,  # read CLICKHOUSE_URL or CLICKHOUSE_* from the environment
        "REGISTRY": "examples.utils.orders.registry",
        "TENANT": f"{__name__}.tenant_for_request",
    },
}


def tenant_for_request(request: HttpRequest) -> str | None:
    # In a real app: request.user.organization_id if request.user.is_authenticated.
    return organization_for(request.headers.get("Authorization"))


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


urlpatterns = [path("revenue", revenue), path("revenue/daily", revenue_by_day)]


def configure() -> None:
    """Apply ``SETTINGS`` once per process, then set Django up."""

    if not settings.configured:
        import django

        settings.configure(**SETTINGS)
        django.setup()


def asgi_application() -> Any:
    """Django plus hypequery's HTTP endpoints under /api, in one ASGI app.

    Run with: uvicorn "examples.django_app:asgi_application" --factory
    """

    configure()
    from django.core.asgi import get_asgi_application

    from hypequery.contrib.django.asgi import mount_serve

    from . import multitenant_saas
    from .utils.orders import principals
    from .utils.server import application

    django_app = get_asgi_application()
    serve_app = application(
        datasets=(multitenant_saas.orders,),
        install=multitenant_saas.install,
        principals=principals(),
    )
    return mount_serve(django_app, serve_app, prefix="/api")


if __name__ == "__main__":
    configure()
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
