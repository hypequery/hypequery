"""Django integration: settings, a per-process client, a tenant-bound client per request.

Add ``"hypequery.contrib.django"`` to ``INSTALLED_APPS`` (its system check
validates the ``HYPEQUERY`` setting), and
``"hypequery.contrib.django.HypequeryMiddleware"`` to ``MIDDLEWARE`` after
Django's authentication middleware. Views then use ``request.analytics``::

    def revenue(request):
        result = request.analytics.execute("orders", {"measures": ["revenue"]})
        return JsonResponse({"data": list(result.data)})

In an async view the same attribute is the async client, so ``await`` it.

Requires ``hypequery[django]``.
"""

from __future__ import annotations

try:
    import django as _django  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in a subprocess
    raise ModuleNotFoundError(
        'hypequery.contrib.django requires Django. Install it with: pip install "hypequery[django]"'
    ) from exc

from .clients import (
    AsyncRequestAnalytics,
    async_tenant_client,
    close_clients,
    get_async_client,
    get_client,
    tenant_client,
)
from .middleware import HypequeryMiddleware

__all__ = [
    "AsyncRequestAnalytics",
    "HypequeryMiddleware",
    "async_tenant_client",
    "close_clients",
    "get_async_client",
    "get_client",
    "tenant_client",
]
