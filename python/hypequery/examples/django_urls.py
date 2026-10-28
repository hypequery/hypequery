"""The Django example's URLconf: its own views, and hypequery's endpoints natively.

Django imports the URLconf once settings are configured, so the API can take
the process client here; ``get_client()`` connects on the first query, not now.
"""

from __future__ import annotations

from django.urls import include, path

from hypequery.contrib.django import get_client, urls

from .django_app import revenue, revenue_by_day
from .utils.analytics import analytics_api

api = analytics_api(get_client())

urlpatterns = [
    path("revenue", revenue),
    path("revenue/daily", revenue_by_day),
    # POST /api/analytics/orders and GET /api/analytics/client-contract.
    path("api/analytics/", include(urls(api))),
]
