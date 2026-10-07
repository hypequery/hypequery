"""Run: python -m examples.multitenant_saas (from python/hypequery).

Seed examples/seed.sql; set CLICKHOUSE_*, HYPEQUERY_TENANT_A_TOKEN and
HYPEQUERY_TENANT_B_TOKEN to distinct tokens. POST /analytics/orders with one
bearer token and {"dimensions":["country"]}. The server maps credentials to
an opaque tenant capability; query bodies cannot choose an organization.
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
    tenant_key="org_id",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)


def install(api: ServeRouter, client: DatasetClient) -> None:
    create_dataset_endpoint(
        dataset=orders,
        client=client,
        policy=EndpointPolicy(
            tenant="required", required_scopes=frozenset({"analytics:read"}), max_limit=100
        ),
    ).install(api, "/analytics/orders")


def create_application() -> FastAPI:
    token_a = required_environment("HYPEQUERY_TENANT_A_TOKEN")
    token_b = required_environment("HYPEQUERY_TENANT_B_TOKEN")
    if token_a == token_b:
        raise ValueError("The tenant tokens must be distinct")
    return application(
        datasets=(orders,),
        install=install,
        principals={
            token_a: Principal(
                subject="alice", tenant_id="a", scopes=frozenset({"analytics:read"})
            ),
            token_b: Principal(subject="bob", tenant_id="b", scopes=frozenset({"analytics:read"})),
        },
    )


if __name__ == "__main__":
    start_server(create_application())
