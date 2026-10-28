"""A standalone hypequery API: no web framework, served by `hypequery dev`.

`app` is plain ASGI, so uvicorn or any ASGI server runs it, and FastAPI,
Starlette or Litestar can mount it.
"""

import os
import secrets

from datasets import datasets

from hypequery.datasets import create_dataset_client, create_dataset_registry
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    create_api,
    create_dataset_endpoint,
    to_asgi_app,
)

# Supply a local development token before opening the database connection.
DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

# Reads CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.
executor = create_clickhouse_executor(ClickHouseConnection.from_env())
registry = create_dataset_registry(*datasets.values())
client = create_dataset_client(executor=executor, registry=registry)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


api = create_api(
    auth=authenticate,
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
for name, definition in datasets.items():
    create_dataset_endpoint(dataset=definition, client=client).install(
        api, f"/datasets/{name}/query"
    )

app = to_asgi_app(api)
