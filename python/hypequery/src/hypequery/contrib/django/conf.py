"""The ``HYPEQUERY`` Django setting, read and validated in one place.

```python
HYPEQUERY = {
    "URL": None,                     # else CLICKHOUSE_URL / CLICKHOUSE_* variables
    "REGISTRY": "analytics.datasets.registry",
    "TENANT": "analytics.tenancy.tenant_for_request",
    "READONLY_POLICY": "query",
    "TIMEZONE": "UTC",
    "MAX_CONCURRENT": 4,
}
```

``REGISTRY`` and ``TENANT`` may be objects or dotted import paths. ``TENANT``
receives the request and returns a tenant id, a ``TenantScope``, or None for a
request with no tenant (tenant-keyed datasets then refuse to run).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache
from typing import cast

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest
from django.utils.module_loading import import_string

from ...datasets import DatasetRegistry
from ...execution import ClickHouseConnection, ReadonlyPolicy
from ..utils.process_clients import ClientConfig
from ..utils.tenant_value import TenantValue

TenantFunction = Callable[[HttpRequest], TenantValue]

_KEYS = frozenset(("URL", "REGISTRY", "TENANT", "READONLY_POLICY", "TIMEZONE", "MAX_CONCURRENT"))


@dataclass(frozen=True, slots=True)
class HypequerySettings:
    client: ClientConfig
    tenant: TenantFunction | None


def _resolve(value: object, key: str) -> object:
    if isinstance(value, str):
        try:
            return import_string(value)
        except ImportError as exc:
            raise ImproperlyConfigured(f"HYPEQUERY['{key}'] could not be imported: {exc}") from exc
    return value


def _connection(raw: Mapping[str, object], policy: ReadonlyPolicy) -> ClickHouseConnection:
    url = raw.get("URL")
    try:
        if url is None:
            return ClickHouseConnection.from_env(readonly_policy=policy)
        if not isinstance(url, str):
            raise ImproperlyConfigured("HYPEQUERY['URL'] must be a string or None")
        return ClickHouseConnection.from_url(url, readonly_policy=policy)
    except ValueError as exc:
        # The messages never echo a URL or a password.
        raise ImproperlyConfigured(f"HYPEQUERY connection settings: {exc}") from exc


@cache
def load_settings() -> HypequerySettings:
    """Validated settings, read once. Raises ``ImproperlyConfigured`` on any mistake.

    Changing ``HYPEQUERY`` (``override_settings`` in a test) clears this and
    closes the clients built from the old value.
    """

    raw = getattr(settings, "HYPEQUERY", {})
    if not isinstance(raw, Mapping):
        raise ImproperlyConfigured("HYPEQUERY must be a dict")
    unknown = sorted(set(raw) - _KEYS)
    if unknown:
        raise ImproperlyConfigured(f"HYPEQUERY has unknown keys: {', '.join(unknown)}")
    policy = cast(ReadonlyPolicy, raw.get("READONLY_POLICY", "query"))
    registry = _resolve(raw.get("REGISTRY"), "REGISTRY")
    if registry is not None and not isinstance(registry, DatasetRegistry):
        raise ImproperlyConfigured("HYPEQUERY['REGISTRY'] must be a DatasetRegistry")
    tenant = _resolve(raw.get("TENANT"), "TENANT")
    if tenant is not None and not callable(tenant):
        raise ImproperlyConfigured("HYPEQUERY['TENANT'] must be a callable taking the request")
    timezone = raw.get("TIMEZONE", "UTC")
    max_concurrent = raw.get("MAX_CONCURRENT", 4)
    connection = _connection(raw, policy)
    try:
        client = ClientConfig(
            connection=connection,
            registry=registry,
            timezone=timezone,
            max_concurrent=max_concurrent,
        )
    except ValueError as exc:
        raise ImproperlyConfigured(f"HYPEQUERY: {exc}") from exc
    return HypequerySettings(client=client, tenant=cast(TenantFunction | None, tenant))
