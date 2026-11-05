"""Application construction with authentication and owned executor lifetime."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetClient,
    create_dataset_client,
    create_dataset_registry,
)
from hypequery.execution import ClickHouseExecutor, QueryRows, create_clickhouse_executor
from hypequery.serve import (
    Api,
    AsgiApp,
    CorsPolicy,
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    create_api,
    to_asgi_app,
)

from .config import connection


class TokenAuthenticator:
    """Replace this local server-side token table with the host's auth service."""

    def __init__(self, principals: Mapping[str, Principal]) -> None:
        if not principals or any(not token for token in principals):
            raise ValueError("Configure nonempty server-side tokens")
        self.principals = dict(principals)

    def __call__(self, credential: Credential) -> Principal | None:
        for token, principal in self.principals.items():
            if secrets.compare_digest(credential.value, token):
                return principal
        return None


class ExecutorLifetime:
    def __init__(self, executor: ClickHouseExecutor) -> None:
        self.executor = executor

    @asynccontextmanager
    async def lifespan(self) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await asyncio.to_thread(self.executor.close)


class ExportOnlyExecutor:
    """Stands in for ClickHouse in an API built only to export its client contract."""

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        raise RuntimeError("This API only exports its client contract; it runs no queries")


def _create_api(
    auth: Callable[[Credential], Principal | None], cors_origins: tuple[str, ...]
) -> Api:
    return create_api(
        auth=auth,
        security=HttpSecurity(
            allowed_hosts=("localhost", "127.0.0.1"),
            cors=CorsPolicy(origins=cors_origins) if cors_origins else None,
        ),
        production=ProductionProfile(
            max_result_rows=101,
            max_result_bytes=1 << 20,
            timeout_seconds=10,
            max_threads=2,
            max_concurrency=8,
        ),
    )


def application(
    *,
    datasets: tuple[Dataset, ...],
    principals: Mapping[str, Principal],
    install: Callable[[Api, DatasetClient], None],
    cors_origins: tuple[str, ...] = (),
) -> AsgiApp:
    authenticator = TokenAuthenticator(principals)
    executor = create_clickhouse_executor(connection())
    try:
        client = create_dataset_client(
            executor=executor, registry=create_dataset_registry(*datasets)
        )
        api = _create_api(authenticator, cors_origins)
        install(api, client)
        return to_asgi_app(api, lifespan=ExecutorLifetime(executor).lifespan)
    except Exception:
        executor.close()
        raise


def contract_api(
    *,
    datasets: tuple[Dataset, ...],
    install: Callable[[Api, DatasetClient], None],
    cors_origins: tuple[str, ...] = (),
) -> Api:
    """The API `application` serves, with no credentials or connection.

    For `hypequery export client-contract`: the contract comes from the same
    `install`, so it cannot drift from the routes the application serves.
    """

    client = create_dataset_client(
        executor=ExportOnlyExecutor(), registry=create_dataset_registry(*datasets)
    )
    api = _create_api(lambda _credential: None, cors_origins)
    install(api, client)
    return api
