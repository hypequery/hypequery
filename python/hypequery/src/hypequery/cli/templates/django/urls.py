"""The URLconf: Django's admin (for its login), your view, and hypequery's endpoints.

In an existing project, add the two ``api/`` entries to your own URLconf.
"""

import analytics
from django.contrib import admin
from django.urls import include, path

from hypequery.contrib.django import django_user, get_client
from hypequery.contrib.django import urls as hypequery_urls

# The process client connects on the first query, not here.
#: For `@hypequery/react` on pages this project serves: Django's own login,
#: with the same-origin check, and Django's CSRF middleware.
session_api = analytics.analytics_api(get_client(), auth=django_user(analytics.principal_for_user))
#: For `@hypequery/mcp`, scripts and curl: an Authorization header.
agents_api = analytics.analytics_api(get_client(), auth=analytics.principal_for_token)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("analytics/<str:dataset>", analytics.dataset_summary),
    path("api/analytics/", include(hypequery_urls(session_api))),
    path("api/agents/", include(hypequery_urls(agents_api))),
]
