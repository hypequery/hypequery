"""Django integration: settings, a per-process client, a tenant-bound client per request.

Add ``"hypequery.contrib.django"`` to ``INSTALLED_APPS`` (its system check
validates the ``HYPEQUERY`` setting), and
``"hypequery.contrib.django.HypequeryMiddleware"`` to ``MIDDLEWARE`` after
Django's authentication middleware. Views then use ``request.analytics``::

    def revenue(request):
        result = request.analytics.execute("orders", {"measures": ["revenue"]})
        return JsonResponse({"data": list(result.data)})

In an async view the same attribute is the async client, so ``await`` it.

To serve hypequery's HTTP endpoints (for ``@hypequery/react`` and
``@hypequery/mcp``) from the project itself, include :func:`urls` for an API
from ``hypequery.serve.create_api``::

    urlpatterns = [path("api/analytics/", include(urls(api)))]

Authenticate those endpoints with the project's own login, so a page it
serves calls them with its session cookie and no token::

    api = create_api(auth=django_user(lambda user: Principal(subject=str(user.pk))), ...)

Requires ``hypequery[django]``.
"""

from __future__ import annotations

try:
    import django as _django  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in a subprocess
    raise ModuleNotFoundError(
        'hypequery.contrib.django requires Django. Install it with: pip install "hypequery[django]"'
    ) from exc

from .auth import UserPrincipal, django_user
from .clients import (
    AsyncRequestAnalytics,
    async_tenant_client,
    close_clients,
    get_async_client,
    get_client,
    tenant_client,
)
from .middleware import HypequeryMiddleware
from .views import urls

__all__ = [
    "AsyncRequestAnalytics",
    "HypequeryMiddleware",
    "UserPrincipal",
    "async_tenant_client",
    "close_clients",
    "django_user",
    "get_async_client",
    "get_client",
    "tenant_client",
    "urls",
]
