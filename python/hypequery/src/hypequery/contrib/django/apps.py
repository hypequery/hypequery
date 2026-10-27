"""App config: validates ``HYPEQUERY`` under ``manage.py check``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from django.apps import AppConfig, apps
from django.core import checks
from django.core.exceptions import ImproperlyConfigured

from .conf import load_settings


def check_settings(app_configs: Sequence[AppConfig] | None = None, **_: Any) -> list[checks.Error]:
    """A bad dotted path, URL or value fails ``check``, not the first query.

    Reads configuration only; it never connects to ClickHouse.
    """

    if app_configs is not None and apps.get_app_config("hypequery") not in app_configs:
        return []
    load_settings.cache_clear()
    try:
        load_settings()
    except ImproperlyConfigured as exc:
        return [checks.Error(str(exc), id="hypequery.E001")]
    return []


class HypequeryConfig(AppConfig):  # type: ignore[misc]  # Django is untyped here
    name = "hypequery.contrib.django"
    label = "hypequery"
    verbose_name = "hypequery"

    def ready(self) -> None:
        checks.register(check_settings)
