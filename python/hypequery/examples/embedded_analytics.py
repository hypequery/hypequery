"""Run: python -m examples.embedded_analytics (from python/hypequery).

Seed examples/seed.sql, set CLICKHOUSE_* and HYPEQUERY_EXAMPLE_TOKEN, then POST
/analytics/orders with a server-held bearer token and {"dimensions":["country"]}.
The host can mint its own short-lived user credentials instead of this token table.
"""

from fastapi import FastAPI

from hypequery.datasets import DatasetClient, dataset, dimension, measure
from hypequery.serve import (
    EndpointPolicy,
    Principal,
    ServeRouter,
    create_dataset_endpoint,
    start_server,
)

from .utils.config import required_environment
from .utils.server import application

orders = dataset(
    "orders",
    source="example_orders",
    time_key="created_at",
    dimensions={
        "country": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)


def install(api: ServeRouter, client: DatasetClient) -> None:
    create_dataset_endpoint(
        dataset=orders,
        client=client,
        policy=EndpointPolicy(required_scopes=frozenset({"analytics:read"}), max_limit=100),
    ).install(api, "/analytics/orders")


def create_application() -> FastAPI:
    app = application(
        datasets=(orders,),
        install=install,
        principals={
            required_environment("HYPEQUERY_EXAMPLE_TOKEN"): Principal(
                subject="analyst",
                scopes=frozenset({"analytics:read"}),
            )
        },
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


if __name__ == "__main__":
    start_server(create_application())
