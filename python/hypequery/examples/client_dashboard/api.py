"""Authenticated ClickHouse API. Construction owns the executor lifetime."""

from fastapi import FastAPI

from hypequery.datasets import DatasetClient
from hypequery.serve import (
    EndpointPolicy,
    Principal,
    ServeRouter,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    add_metric_endpoint,
)

from ..utils.config import required_environment
from ..utils.server import application
from .definitions import orders, profile


def install(api: ServeRouter, client: DatasetClient) -> None:
    policy = EndpointPolicy(tenant="required", required_scopes=frozenset({"analytics:read"}))
    add_dataset_endpoint(
        api, "/v1/orders", dataset=orders, client=client, policy=policy, client_profile=profile
    )
    add_metric_endpoint(
        api,
        "/v1/sales",
        dataset=orders,
        client=client,
        policy=policy,
        measure="revenue",
        name="sales",
        client_profile=profile,
    )
    add_client_contract_endpoint(api, "/v1/client-contract", policy=policy)


def create_application() -> FastAPI:
    token_a = required_environment("HYPEQUERY_TENANT_A_TOKEN")
    token_b = required_environment("HYPEQUERY_TENANT_B_TOKEN")
    if token_a == token_b:
        raise ValueError("The tenant tokens must be distinct")
    return application(
        datasets=(orders,),
        install=install,
        cors_origins=("http://127.0.0.1:5173",),
        principals={
            token_a: Principal(
                subject="alice", tenant_id="a", scopes=frozenset({"analytics:read"})
            ),
            token_b: Principal(subject="bob", tenant_id="b", scopes=frozenset({"analytics:read"})),
        },
    )
