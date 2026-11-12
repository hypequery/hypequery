"""Django settings. The app's own data (users, organizations) lives in SQLite
through the ORM; analytics come from ClickHouse through hypequery."""

import os
from pathlib import Path

from analytics.connection import clickhouse_url

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "demo-only-change-me-5d1e8c2a9b")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "hypequery.contrib.django",  # `manage.py check` validates HYPEQUERY below
    "accounts",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Demo only: signs the request in as the user named in X-Demo-User.
    # Delete it and your normal session login sets request.user instead.
    "accounts.middleware.DemoUserHeaderMiddleware",
    # request.analytics: a hypequery client bound to the user's tenant.
    "hypequery.contrib.django.HypequeryMiddleware",
]

AUTHENTICATION_BACKENDS = [
    "accounts.middleware.DemoUserBackend",
    "django.contrib.auth.backends.ModelBackend",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"

HYPEQUERY = {
    "URL": clickhouse_url(),  # from CLICKHOUSE_URL + CLICKHOUSE_USERNAME/PASSWORD/DATABASE
    "REGISTRY": "analytics.datasets.registry",
    "TENANT": "analytics.tenancy.tenant_for_request",
}
