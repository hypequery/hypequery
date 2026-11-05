"""Local browser wiring fixture. SQLite exercises HTTP/UI, not ClickHouse certification."""

from hypequery.datasets import (
    ClientQueryProfile,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.serve import (
    Api,
    CorsPolicy,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
)
from sqlite_executor import BrowserFixtureExecutor

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="org_id",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount"), "rows": measure.count("id")},
)
profile = ClientQueryProfile(default_limit=10, max_limit=10)


def installed(executor: BrowserFixtureExecutor) -> Api:
    client = create_dataset_client(executor=executor)
    api = create_api(
        base_path="/v1",
        client_mount_path="/mounted",
        auth=lambda credential: {
            "browser-a": Principal(subject="alice", tenant_id="a"),
            "browser-b": Principal(subject="bob", tenant_id="b"),
        }.get(credential.value),
        security=HttpSecurity(
            allowed_hosts=("127.0.0.1",),
            cors=CorsPolicy(origins=("http://127.0.0.1:8791",)),
        ),
    )
    policy = EndpointPolicy(tenant="required")
    add_dataset_endpoint(
        api,
        "/orders",
        dataset=orders,
        client=client,
        policy=policy,
        client_profile=profile,
    )
    add_metric_endpoint(
        api,
        "/sales",
        dataset=orders,
        client=client,
        policy=policy,
        measure="revenue",
        name="sales",
        client_profile=profile,
    )
    add_client_contract_endpoint(api)
    return api


def build() -> Api:
    """The installed API for `hypequery export client-contract`: no framework import."""
    return installed(BrowserFixtureExecutor())


def app():
    from contextlib import asynccontextmanager

    from fastapi import FastAPI
    from hypequery.serve import to_asgi_app

    executor = BrowserFixtureExecutor()
    api = installed(executor)

    @asynccontextmanager
    async def lifespan(_):
        try:
            yield
        finally:
            executor.close()

    # FastAPI is only the host here: the API is mounted in it as plain ASGI.
    outer = FastAPI(lifespan=lifespan)
    outer.mount("/mounted", to_asgi_app(api))
    return outer
