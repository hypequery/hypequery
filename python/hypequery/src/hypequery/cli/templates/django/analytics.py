"""hypequery for Django: the registry, who may query, the API and an example view.

`urls.py` serves the API twice: behind Django's own login for pages this
project serves, and behind a bearer token for `@hypequery/mcp` and scripts.
The connection comes from CLICKHOUSE_URL, or CLICKHOUSE_HOST, _PORT, ...
"""

import os
import secrets
from typing import Any

from datasets import datasets
from django.contrib.auth.decorators import login_required
from django.http import HttpRequest, JsonResponse

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQueryError,
    DatasetClient,
    create_dataset_registry,
)
from hypequery.serve import (
    Api,
    Authenticator,
    ContextStrategy,
    Credential,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)

registry = create_dataset_registry(*datasets.values())
#: For local development only: see principal_for_token.
DEV_TOKEN = os.environ.get("HYPEQUERY_DEV_TOKEN", "")


def tenant_of(user: Any) -> str | None:
    """The tenant a signed-in user's queries are scoped to, or None.

    None leaves datasets with a tenant_key unqueryable, which is the safe default
    until this reads your user model, e.g. ``str(user.organization_id)``.
    """

    # __TENANT_HINT__
    return None


def principal_for_user(user: Any) -> Principal:
    """Who a signed-in user queries as; anonymous users get 401 before this runs."""

    return Principal(subject=str(user.pk), tenant_id=tenant_of(user))


def principal_for_token(credential: Credential) -> Principal | None:
    """Who a bearer token queries as, for `@hypequery/mcp`, scripts and curl.

    Accepts HYPEQUERY_DEV_TOKEN as the bearer token, and refuses every token
    while it is unset. Replace this with your own credential check, or
    ``jwt_strategy`` from the ``jwt`` extra, before production. Its principal
    has no tenant, so datasets with a tenant_key refuse it.
    """

    if DEV_TOKEN and secrets.compare_digest(credential.value, DEV_TOKEN):
        return Principal(subject="developer")
    return None


def tenant_for_request(request: HttpRequest) -> str | None:
    """HypequeryMiddleware's tenant for ``request.analytics`` in your own views."""

    return tenant_of(request.user) if request.user.is_authenticated else None


def analytics_api(client: DatasetClient, *, auth: Authenticator | ContextStrategy) -> Api:
    """``POST /<dataset>`` for every dataset, and ``GET /client-contract``.

    The client contract is what typed `@hypequery/react` clients pin and the
    MCP bridge discovers. Django's ALLOWED_HOSTS checks the Host header.
    """

    api = create_api(auth=auth)
    for name, definition in datasets.items():
        add_dataset_endpoint(
            api,
            f"/{name}",
            dataset=definition,
            client=client,
            client_profile=ClientQueryProfile(),
        )
    add_client_contract_endpoint(api)
    return api


@login_required
def dataset_summary(request: HttpRequest, dataset: str) -> JsonResponse:
    """A view of your own: every base measure of *dataset*, for the user's tenant."""

    if dataset not in datasets:
        return JsonResponse({"error": "unknown dataset"}, status=404)
    try:
        result = request.analytics.execute(dataset, {"limit": 100})
    except CompiledQueryError as error:
        status = 403 if error.category == "tenant-required" else 400
        return JsonResponse({"error": error.category}, status=status)
    return JsonResponse({"data": list(result.data)})
