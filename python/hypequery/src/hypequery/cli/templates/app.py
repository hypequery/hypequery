import os
import secrets

from hypequery.datasets import Dataset, count, create_dataset_client, dimension, measure
from hypequery.datasets import sum as sql_sum
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    create_app,
    create_router,
)

orders = Dataset(
    name="orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "id": dimension("string"),
        "country": dimension("string"),
        "status": dimension("string"),
        "createdAt": dimension("timestamp", column="created_at"),
    },
    measures={
        "revenue": measure(sql_sum("amount")),
        "orderCount": measure(count("id")),
    },
)

# Supply a local development token before opening the database connection.
DEV_TOKEN = os.environ["HYPEQUERY_DEV_TOKEN"]
if not DEV_TOKEN:
    raise ValueError("HYPEQUERY_DEV_TOKEN must not be empty")

executor = create_clickhouse_executor(
    ClickHouseConnection(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
        username=os.environ.get("CLICKHOUSE_USERNAME", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
    )
)
client = create_dataset_client(executor=executor)


def authenticate(credential: Credential) -> Principal | None:
    if secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


router = create_router(authenticate=authenticate)
add_dataset_endpoint(router, "/datasets/orders/query", dataset=orders, client=client)

app = create_app(
    router,
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
