"""The process's dataset clients, built from the ``HYPEQUERY`` setting."""

from __future__ import annotations

from typing import Any

from django.core.signals import setting_changed
from django.http import HttpRequest

from ...datasets import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    TenantDatasetClient,
)
from ..utils.process_clients import ProcessClients
from ..utils.tenant_value import bind_tenant_value
from .conf import load_settings

_clients = ProcessClients(lambda: load_settings().client)


def _settings_changed(*, setting: str, **_: Any) -> None:
    if setting == "HYPEQUERY":
        load_settings.cache_clear()
        _clients.close()


setting_changed.connect(_settings_changed, dispatch_uid="hypequery.contrib.django")


def get_client() -> DatasetClient:
    """The process-wide sync client, created on first use and closed at exit.

    It is unscoped: bind a tenant with ``for_tenant`` before running queries on
    a request's behalf, or use :func:`tenant_client`.
    """

    return _clients.sync()


def get_async_client() -> AsyncDatasetClient:
    """The async client for the running event loop.

    It runs the sync driver on worker threads, so no aiohttp session is left
    open when the process exits. Call it from inside an async view.
    """

    return _clients.async_client()


def close_clients() -> None:
    """Close every client this process opened. Registered with ``atexit``."""

    _clients.close()


def tenant_client(request: HttpRequest) -> DatasetClient | TenantDatasetClient:
    """The sync client bound to the tenant ``HYPEQUERY['TENANT']`` returns for *request*.

    With no ``TENANT`` setting, or when it returns None, this is the unscoped
    client; datasets with a ``tenant_key`` then refuse to run.
    """

    resolve = load_settings().tenant
    return bind_tenant_value(get_client(), resolve(request) if resolve else None)


def async_tenant_client(request: HttpRequest) -> AsyncDatasetClient | AsyncTenantDatasetClient:
    """The async counterpart of :func:`tenant_client`, for async views.

    ``HYPEQUERY['TENANT']`` is called synchronously, so in an async view it must
    not touch the database; read what it needs from the already-loaded user
    (``await request.auser()`` first) or the session.
    """

    resolve = load_settings().tenant
    return bind_tenant_value(get_async_client(), resolve(request) if resolve else None)
