"""Django settings for every test module that needs Django, configured once.

Settings can be configured only once per process, so the contrib tests and the
serve transport tests share these and override what they need per test.
"""

from __future__ import annotations

import django
from django.conf import settings


def configure_django() -> None:
    if settings.configured:
        return
    settings.configure(
        DEBUG=False,
        SECRET_KEY="hypequery-tests",  # noqa: S106 - a test secret
        ALLOWED_HOSTS=["testserver"],
        ROOT_URLCONF="test_contrib_django",
        INSTALLED_APPS=["hypequery.contrib.django"],
        MIDDLEWARE=["hypequery.contrib.django.HypequeryMiddleware"],
        HYPEQUERY={
            "URL": "clickhouse://reader@ch/hq",
            "REGISTRY": "contrib_doubles.REGISTRY",
            "TENANT": "test_contrib_django.tenant_for",
            "TIMEZONE": "UTC",
            "MAX_CONCURRENT": 2,
        },
    )
    django.setup()
