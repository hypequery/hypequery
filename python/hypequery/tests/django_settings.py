"""Django settings for every test module that needs Django, configured once.

Settings can be configured only once per process, so the contrib tests and the
serve transport tests share these and override what they need per test. The
database is a SQLite file, so threads (a sync view's request thread, the async
ORM's) share it; `migrated()` creates its tables for the tests that use users.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

import django
from django.conf import settings

_migrated = False


def configure_django() -> None:
    if settings.configured:
        return
    settings.configure(
        DEBUG=False,
        SECRET_KEY="hypequery-tests",  # noqa: S106 - a test secret
        ALLOWED_HOSTS=["testserver"],
        ROOT_URLCONF="test_contrib_django",
        INSTALLED_APPS=[
            "django.contrib.auth",
            "django.contrib.contenttypes",
            "django.contrib.sessions",
            "hypequery.contrib.django",
        ],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": _database()}},
        PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
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


def migrated() -> None:
    """Configure Django and create its tables, once per process."""

    global _migrated
    configure_django()
    if not _migrated:
        from django.core.management import call_command

        call_command("migrate", verbosity=0, interactive=False)
        _migrated = True


def _database() -> str:
    directory = tempfile.mkdtemp(prefix="hypequery-django-")
    atexit.register(shutil.rmtree, directory, ignore_errors=True)
    return os.path.join(directory, "db.sqlite3")
