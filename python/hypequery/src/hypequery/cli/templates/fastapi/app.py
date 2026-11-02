"""A FastAPI app serving hypequery's endpoints, and a route of your own.

Run: uvicorn app:app --reload

hypequery's endpoints are mounted at /api/agents behind a bearer token, for
`@hypequery/mcp`, scripts and curl. /analytics/{dataset} is a route of your
own, querying through the same client as the user your login resolves.
The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
"""

import os
import secrets
from typing import Annotated, Any

from datasets import datasets
from fastapi import Depends, FastAPI, HTTPException, Request

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQueryError,
    create_dataset_client,
    create_dataset_registry,
    tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
    to_asgi_app,
)

# Reads CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.
executor = create_clickhouse_executor(ClickHouseConnection.from_env())
registry = create_dataset_registry(*datasets.values())
client = create_dataset_client(executor=executor, registry=registry)
#: For local development only: see principal_for_token.
DEV_TOKEN = os.environ.get("HYPEQUERY_DEV_TOKEN", "")
#: The tenant the token reads, for datasets with a tenant_key; unset, it reads none of them.
DEV_TENANT = os.environ.get("HYPEQUERY_DEV_TENANT") or None
#: Add your domain before deploying: a request for any other Host is refused.
SECURITY = HttpSecurity(allowed_hosts=("127.0.0.1", "localhost"))


def principal_for_token(credential: Credential) -> Principal | None:
    """Who a bearer token queries as, for `@hypequery/mcp`, scripts and curl.

    Accepts HYPEQUERY_DEV_TOKEN as the bearer token, and refuses every token
    while it is unset. Replace this with your own credential check, or
    ``jwt_strategy`` from the ``jwt`` extra, before production. Its principal
    uses HYPEQUERY_DEV_TENANT; without one, datasets with a tenant_key refuse it.
    """

    if DEV_TOKEN and secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer", tenant_id=DEV_TENANT)
    return None


def current_principal(request: Request) -> Principal | None:
    """Who the signed-in user queries as in your own routes, or None to answer 401.

    None until this reads your login, so /analytics refuses everyone; for
    example ``Principal(subject=user.id, tenant_id=user.org_id)`` from the user
    your authentication dependency resolves.
    """

    # __TENANT_HINT__
    return None


# The agents API: `POST /<dataset>` for every dataset, and `GET /client-contract`,
# which the MCP bridge discovers.
agents_api = create_api(
    auth=principal_for_token, security=SECURITY, client_mount_path="/api/agents"
)
for name, definition in datasets.items():
    add_dataset_endpoint(
        agents_api,
        f"/{name}",
        dataset=definition,
        client=client,
        client_profile=ClientQueryProfile(),
        # A tenant-scoped dataset needs a principal with a tenant, and is left
        # out of the client contract of one without.
        policy=EndpointPolicy(tenant="required" if definition.tenant_key else "optional"),
    )
add_client_contract_endpoint(agents_api)

app = FastAPI()
app.mount("/api/agents", to_asgi_app(agents_api))


@app.get("/analytics/{dataset}")
def dataset_summary(
    dataset: str, principal: Annotated[Principal | None, Depends(current_principal)]
) -> dict[str, Any]:
    """A route of your own: every base measure of *dataset*, for the user's tenant."""

    if principal is None:
        raise HTTPException(401, "sign in first")
    if dataset not in datasets:
        raise HTTPException(404, "unknown dataset")
    tenant_id = principal.tenant_id
    scoped = client if tenant_id is None else client.for_tenant(tenant(tenant_id))
    try:
        result = scoped.execute(dataset, {"limit": 100})
    except CompiledQueryError as error:
        status = 403 if error.category == "tenant-required" else 400
        raise HTTPException(status, error.category) from None
    return {"data": list(result.data)}
