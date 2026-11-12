"""The security boundary: one ClickHouse client, token issuing and verifying,
and hypequery's query endpoints over the datasets. app.py mounts `api`."""

from __future__ import annotations

import os

from hypequery.datasets import create_async_dataset_client
from hypequery.execution import create_async_from_sync_clickhouse_executor
from hypequery.serve import (
    EndpointPolicy,
    analytics_token_issuer,
    create_api,
    create_dataset_endpoint,
    jwt_strategy,
)

from analytics.connection import connection_from_env
from analytics.datasets import events, subscriptions

# One executor per process: bounded worker threads over the sync driver, so
# nothing leaks if the host has no shutdown hook. app.py closes it on shutdown.
executor = create_async_from_sync_clickhouse_executor(connection_from_env())
client = create_async_dataset_client(executor=executor)

# Your server mints short-lived tokens; hypequery verifies them and takes the
# tenant from the token's org_id claim. Set HYPEQUERY_AUTH_SECRET in production.
SECRET = os.environ.get("HYPEQUERY_AUTH_SECRET", "demo-only-change-me-7c9a4b1f2e3d")
AUDIENCE = "analytics"
issue_token = analytics_token_issuer(SECRET, audience=AUDIENCE)  # (subject, tenant_id=, roles=) -> str
verify_token = jwt_strategy(secret=SECRET, audience=AUDIENCE)  # await verify_token(Credential) -> Principal

# Every request must carry a tenant, and no page is larger than 500 rows.
policy = EndpointPolicy(tenant="required", max_limit=500)

api = create_api(
    auth=verify_token,
    client=client,
    client_mount_path="/analytics",  # where app.mount() puts it, for generated clients
    development_docs=os.environ.get("HYPEQUERY_DEV_DOCS") == "1",  # GET /analytics/docs
    datasets={
        "events": create_dataset_endpoint(dataset=events, client=client, policy=policy),
        "subscriptions": create_dataset_endpoint(dataset=subscriptions, client=client, policy=policy),
    },
)
