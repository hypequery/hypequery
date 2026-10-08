import os
import secrets

from hypequery.datasets import create_dataset_client, dataset, dimension, measure
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    create_api,
    create_app,
    create_dataset_endpoint,
)

orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "id": dimension.string(),
        "country": dimension.string(),
        "status": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
    },
)

# Supply a local development token before opening the database connection.
DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

# Reads CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.
executor = create_clickhouse_executor(ClickHouseConnection.from_env())
client = create_dataset_client(executor=executor)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


api = create_api(authenticate=authenticate)
create_dataset_endpoint(dataset=orders, client=client).install(api, "/datasets/orders/query")

app = create_app(
    api,
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
