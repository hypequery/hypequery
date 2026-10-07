"""Application construction with authentication and owned executor lifetime."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager

from fastapi import FastAPI

from hypequery.datasets import (
    Dataset,
    DatasetClient,
    create_dataset_client,
    create_dataset_registry,
)
from hypequery.execution import ClickHouseExecutor, create_clickhouse_executor
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    ServeRouter,
    create_api,
    create_app,
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
    async def lifespan(self, app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await asyncio.to_thread(self.executor.close)


def application(
    *,
    datasets: tuple[Dataset, ...],
    principals: Mapping[str, Principal],
    install: Callable[[ServeRouter, DatasetClient], None],
) -> FastAPI:
    authenticator = TokenAuthenticator(principals)
    executor = create_clickhouse_executor(connection())
    try:
        client = create_dataset_client(
            executor=executor, registry=create_dataset_registry(*datasets)
        )
        api = create_api(authenticate=authenticator)
        install(api, client)
        app = create_app(
            api,
            security=HttpSecurity(allowed_hosts=("localhost", "127.0.0.1")),
            production=ProductionProfile(
                max_result_rows=101,
                max_result_bytes=1 << 20,
                timeout_seconds=10,
                max_threads=2,
                max_concurrency=8,
            ),
        )
        app.router.lifespan_context = ExecutorLifetime(executor).lifespan
        return app
    except Exception:
        executor.close()
        raise
