"""A seeded demo database, its API and an MCP executor signed in as one tenant."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from hypequery.datasets import AsyncDatasetClient, create_async_dataset_client
from hypequery.execution import create_async_chdb_executor
from hypequery.mcp import ApiContractBackend, ClientContractExecutor
from hypequery.serve import Api

from .api import build_demo_api, tenant_headers
from .database import seed_database


@dataclass(frozen=True, slots=True)
class DemoSession:
    path: Path
    api: Api
    client: AsyncDatasetClient
    #: The MCP tools as the session's tenant sees them.
    agent: ClientContractExecutor


async def agent_for(api: Api, tenant_id: str) -> ClientContractExecutor:
    """An MCP executor on *api*, signed in as *tenant_id*."""

    return await ClientContractExecutor.create(
        ApiContractBackend(api, headers=tenant_headers(tenant_id))
    )


@asynccontextmanager
async def demo_session(tenant_id: str) -> AsyncIterator[DemoSession]:
    """Seed a fresh database in a temporary directory, deleted on exit."""

    with TemporaryDirectory(prefix="hypequery-demo-") as directory:
        path = Path(directory) / "demo.chdb"
        # stdout may be the MCP transport: only protocol messages go there.
        with redirect_stdout(sys.stderr):
            seed_database(path)
        executor = create_async_chdb_executor(str(path))
        try:
            client = create_async_dataset_client(executor=executor)
            api = build_demo_api(client)
            yield DemoSession(path, api, client, await agent_for(api, tenant_id))
        finally:
            await executor.aclose()
