"""Settings for running this project as it is: ``python manage.py runserver``.

In an existing project, copy the lines marked "hypequery" into your settings.
Before deploying, set DJANGO_SECRET_KEY, DEBUG = False and your ALLOWED_HOSTS.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-__DJANGO_SECRET_KEY__")
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # hypequery: its system check validates HYPEQUERY.
    "hypequery.contrib.django",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    # hypequery: request.analytics in your views; after AuthenticationMiddleware.
    "hypequery.contrib.django.HypequeryMiddleware",
]
ROOT_URLCONF = "urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
# Users and sessions; create the tables with `python manage.py migrate`.
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
STATIC_URL = "static/"
LOGIN_URL = "/admin/login/"

# hypequery: the connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
HYPEQUERY = {"REGISTRY": "analytics.registry", "TENANT": "analytics.tenant_for_request"}
