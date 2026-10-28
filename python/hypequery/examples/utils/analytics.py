"""hypequery's HTTP endpoints, as the Django and Flask examples serve them natively.

`analytics_api` is what ``@hypequery/react`` and ``@hypequery/mcp`` call: the
orders dataset as a strict client endpoint, and the caller-scoped client
contract that generated React clients pin and the MCP bridge discovers. Each
example serves it twice, with the same endpoints:

- at `MOUNT_PATH`, authenticated by the app's own login (``django_user`` or
  ``flask_session``), for the same-origin React page (`PAGE`): the browser
  sends its session cookie and no token;
- at `AGENT_MOUNT_PATH`, authenticated by a bearer token, for callers with no
  browser session: the MCP bridge, scripts, curl.

`build` is the React contract offline, for ``hypequery export client-contract``.
"""

from __future__ import annotations

from pathlib import Path

from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    DatasetClient,
    export_client_contract,
)
from hypequery.protocol import PreparedProtocolClientContract
from hypequery.serve import (
    Api,
    Authenticator,
    ContextStrategy,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)

from .orders import ORGANIZATIONS, orders, organization_for_token

#: Where both examples mount the API the React page calls with its session.
MOUNT_PATH = "/api/analytics"
#: Where they mount the same endpoints for token callers, such as the MCP bridge.
AGENT_MOUNT_PATH = "/api/agents"
PROFILE = ClientQueryProfile(default_limit=20, max_limit=100)
POLICY = EndpointPolicy(tenant="required")
SECURITY = HttpSecurity(allowed_hosts=("localhost", "127.0.0.1", "testserver"))
#: The same-origin React page both examples serve at ``/``: React and
#: ``@hypequery/react`` from a CDN, no build step.
PAGE = (Path(__file__).parent / "analytics_page.html").read_bytes()


def principal_for(credential: Credential) -> Principal | None:
    """Replace this token table with your own credential check (API keys, JWTs)."""

    return principal_for_organization(organization_for_token(credential.value))


def principal_for_organization(organization: str | None) -> Principal | None:
    """The principal a signed-in organization's session maps to."""

    if organization not in ORGANIZATIONS:
        return None
    return Principal(subject=f"org-{organization}", tenant_id=organization)


def analytics_api(client: DatasetClient, *, auth: Authenticator | ContextStrategy) -> Api:
    """The API, querying through *client*, the framework integration's process client."""

    api = create_api(auth=auth, security=SECURITY)
    add_dataset_endpoint(
        api, "/orders", dataset=orders, client=client, policy=POLICY, client_profile=PROFILE
    )
    add_client_contract_endpoint(api, policy=POLICY)
    return api


def build() -> PreparedProtocolClientContract:
    """The contract offline, with the paths the React page's API serves."""

    return export_client_contract(
        [ClientEndpointDefinition(orders, "/orders", PROFILE)], mount_path=MOUNT_PATH
    )
