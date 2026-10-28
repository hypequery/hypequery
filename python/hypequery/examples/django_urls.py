"""The Django example's URLconf: its own views, and hypequery's endpoints natively.

Django imports the URLconf once settings are configured, so the APIs can take
the process client here; ``get_client()`` connects on the first query, not now.
"""

from __future__ import annotations

from django.urls import include, path

from hypequery.contrib.django import django_user, get_client, urls

from .django_app import page, principal_for_user, revenue, revenue_by_day, sign_in, sign_out
from .utils.analytics import analytics_api, principal_for

#: For the React page: the project's own login, with no token.
api = analytics_api(get_client(), auth=django_user(principal_for_user))
#: For the MCP bridge and scripts: a bearer token.
agents = analytics_api(get_client(), auth=principal_for)

urlpatterns = [
    path("", page),
    path("login", sign_in),
    path("logout", sign_out),
    path("revenue", revenue),
    path("revenue/daily", revenue_by_day),
    # POST .../orders and GET .../client-contract under each prefix.
    path("api/analytics/", include(urls(api))),
    path("api/agents/", include(urls(agents))),
]
