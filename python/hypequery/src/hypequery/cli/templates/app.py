"""A standalone hypequery API: no web framework, served by `hypequery dev`.

`app` is plain ASGI, so uvicorn or any ASGI server runs it, and FastAPI,
Starlette or Litestar can mount it.
"""

from datasets import datasets

from hypequery.datasets import create_dataset_client, create_dataset_registry
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    HttpSecurity,
    Principal,
    ServeRequest,
    create_api,
    create_dataset_endpoint,
    from_context,
    to_asgi_app,
)

# Reads CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, _DATABASE, _USERNAME, _PASSWORD and _SECURE.
executor = create_clickhouse_executor(ClickHouseConnection.from_env())
registry = create_dataset_registry(*datasets.values())
client = create_dataset_client(executor=executor, registry=registry)


def developer(request: ServeRequest) -> Principal:
    """Who every request queries as: the API is open, for local development only.

    Before deploying, replace ``auth`` below with real authentication:
    ``jwt_strategy`` from the ``jwt`` extra, ``from_context`` reading your
    host app's login, or your own credential check. A ``ProductionProfile``
    refuses this open API, and ``hypequery dev`` warns when bound beyond
    127.0.0.1.
    """

    # This principal has no tenant, so datasets with a tenant_key refuse it
    # with 403 "requires runtime tenant scoping". To test one tenant locally:
    #     return Principal(subject="developer", tenant_id="org_123")
    return Principal(subject="developer")


api = create_api(
    # Open for local development; see developer above.
    auth=from_context(developer, same_origin=False),
    security=HttpSecurity(allowed_hosts=("127.0.0.1", "localhost")),
    development_docs=True,
)
for name, definition in datasets.items():
    create_dataset_endpoint(dataset=definition, client=client).install(
        api, f"/datasets/{name}/query"
    )

app = to_asgi_app(api)
