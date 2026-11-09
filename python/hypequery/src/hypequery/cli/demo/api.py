"""The demo's `hypequery.serve` API: one dataset endpoint per demo dataset."""

from __future__ import annotations

from hypequery.datasets import AsyncDatasetClient, ClientQueryProfile
from hypequery.serve import (
    Api,
    Credential,
    EndpointPolicy,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)

from .model import demo_datasets

#: The seeded tenants. Each is also its own demo credential.
TENANTS = ("acme", "globex")
DEFAULT_TENANT = "acme"


def authenticate(credential: Credential) -> Principal | None:
    """The demo's stand-in for real auth: the bearer token names the tenant."""

    if credential.value in TENANTS:
        return Principal(subject=f"demo-{credential.value}", tenant_id=credential.value)
    return None


def tenant_headers(tenant: str) -> dict[str, str]:
    """The headers that authenticate as *tenant* through `authenticate`."""

    return {"authorization": f"Bearer {tenant}"}


def build_demo_api(client: AsyncDatasetClient) -> Api:
    """An API serving every demo dataset to its tenant, with a client contract for MCP."""

    api = create_api(auth=authenticate)
    policy = EndpointPolicy(tenant="required")
    for definition in demo_datasets():
        add_dataset_endpoint(
            api,
            f"/datasets/{definition.name}",
            dataset=definition,
            client=client,
            policy=policy,
            client_profile=ClientQueryProfile(),
        )
    add_client_contract_endpoint(api)
    return api
