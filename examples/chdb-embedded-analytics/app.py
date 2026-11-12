"""The same datasets over HTTP: `POST /datasets/events/query`.

    uv run python -m hypequery.serve.dev app:app
"""

from __future__ import annotations

import os
import secrets

from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    create_api,
    create_dataset_endpoint,
    to_asgi_app,
)

from analytics.backend import open_client, open_executor
from analytics.datasets import events, tenants

executor = open_executor()  # chDB by default; ANALYTICS_BACKEND=clickhouse for a server
client = open_client(executor)

# A development token. Replace it with your real authentication (jwt_strategy, API keys).
DEV_TOKEN = os.environ.get("HYPEQUERY_DEV_TOKEN", "local-dev-token")


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


api = create_api(
    auth=authenticate,
    client=client,
    datasets={
        # An endpoint serves only the relationships it lists: `tenant.plan` etc.
        "events": create_dataset_endpoint(dataset=events, client=client, include_related=("tenant",)),
        "tenants": tenants,
    },
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=os.environ.get("HYPEQUERY_DEV_DOCS") == "1",
)

app = to_asgi_app(api)
