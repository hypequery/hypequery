"""A governed ClickHouse MCP server in Python.

The agent gets four tools (list_datasets, get_dataset_schema, query_dataset,
query_metric) over the datasets published below, and nothing else: no SQL,
no table it was not given, and one tenant, fixed by TENANT_ID in the
environment the MCP client launches this process with.

    TENANT_ID=153 uv run server.py      # speaks MCP over stdio
"""

from __future__ import annotations

import os
import secrets
import sys

import anyio
from hypequery.datasets import AsyncDatasetClient, ClientQueryProfile, create_async_dataset_client
from hypequery.execution import create_async_from_sync_clickhouse_executor
from hypequery.mcp import ApiContractBackend, ClientContractExecutor, create_mcp_server, serve_stdio
from hypequery.serve import Api, Credential, EndpointPolicy, Principal, add_client_contract_endpoint
from hypequery.serve import add_dataset_endpoint, create_api

from analytics.connection import connection_from_env
from analytics.datasets import events, subscriptions

TENANT_ID = os.environ.get("TENANT_ID", "").strip()
# The API below is never served over HTTP: only this process's MCP backend holds the key.
SESSION_KEY = secrets.token_urlsafe(32)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, SESSION_KEY):
        return Principal(subject="mcp-agent", tenant_id=TENANT_ID)
    return None


def build_api(client: AsyncDatasetClient) -> Api:
    api = create_api(auth=authenticate)
    policy = EndpointPolicy(tenant="required", max_limit=500)
    for published in (events, subscriptions):  # the allowlist: the seed's `tenants` table is not here
        add_dataset_endpoint(
            api,
            f"/datasets/{published.name}",
            dataset=published,
            client=client,
            policy=policy,
            client_profile=ClientQueryProfile(),
        )
    add_client_contract_endpoint(api)  # the catalog the MCP tools are built from
    return api


async def main() -> None:
    executor = create_async_from_sync_clickhouse_executor(connection_from_env())
    try:
        api = build_api(create_async_dataset_client(executor=executor))
        backend = ApiContractBackend(api, headers={"authorization": f"Bearer {SESSION_KEY}"})
        tools = await ClientContractExecutor.create(backend)
        await serve_stdio(create_mcp_server(tools, name="hypequery-seed-analytics", version="0.1.0"))
    finally:
        await executor.aclose()


if __name__ == "__main__":
    if not TENANT_ID:
        print("Set TENANT_ID to the tenant this server may see, e.g. TENANT_ID=153.", file=sys.stderr)
        sys.exit(2)
    anyio.run(main)
