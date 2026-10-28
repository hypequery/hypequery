"""hypequery's HTTP endpoints, as the Django and Flask examples serve them natively.

`analytics_api` is what ``@hypequery/react`` and ``@hypequery/mcp`` call: the
orders dataset as a strict client endpoint, and the caller-scoped client
contract that generated React clients pin and the MCP bridge discovers. Django
mounts it with ``urls(api)`` and Flask with ``blueprint(api)``, both at
`MOUNT_PATH`. Callers authenticate with a bearer token for now; the framework's
own login (``from_context``) comes with decision 0023 step 5.

`build` is the same contract offline, for ``hypequery export client-contract``.
"""

from __future__ import annotations

from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    DatasetClient,
    export_client_contract,
)
from hypequery.protocol import PreparedProtocolClientContract
from hypequery.serve import (
    Api,
    CorsPolicy,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)

from .orders import orders, organization_for_token

#: Where both examples mount the API.
MOUNT_PATH = "/api/analytics"
#: The React dev server the browser calls the API from.
FRONTEND_ORIGIN = "http://localhost:5173"
PROFILE = ClientQueryProfile(default_limit=20, max_limit=100)
POLICY = EndpointPolicy(tenant="required")


def principal_for(credential: Credential) -> Principal | None:
    """Replace this token table with your own credential check (API keys, JWTs)."""

    organization = organization_for_token(credential.value)
    if organization is None:
        return None
    return Principal(subject=f"org-{organization}", tenant_id=organization)


def analytics_api(client: DatasetClient) -> Api:
    """The API, querying through *client*, the framework integration's process client."""

    api = create_api(
        auth=principal_for,
        security=HttpSecurity(
            allowed_hosts=("localhost", "127.0.0.1", "testserver"),
            cors=CorsPolicy(origins=(FRONTEND_ORIGIN,)),
        ),
    )
    add_dataset_endpoint(
        api, "/orders", dataset=orders, client=client, policy=POLICY, client_profile=PROFILE
    )
    add_client_contract_endpoint(api, policy=POLICY)
    return api


def build() -> PreparedProtocolClientContract:
    """The contract offline, with the paths the mounted API serves."""

    return export_client_contract(
        [ClientEndpointDefinition(orders, "/orders", PROFILE)], mount_path=MOUNT_PATH
    )
