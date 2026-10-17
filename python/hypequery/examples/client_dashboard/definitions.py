"""Pure definitions and offline export. No framework, auth or database imports."""

from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    dataset,
    dimension,
    export_client_contract,
    measure,
)
from hypequery.protocol import PreparedProtocolClientContract

orders = dataset(
    "orders",
    source="client_orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)
profile = ClientQueryProfile(default_limit=20, max_limit=100)


def build() -> PreparedProtocolClientContract:
    """Explicit offline factory, with the exact paths installed by the API."""
    return export_client_contract(
        [
            ClientEndpointDefinition(orders, "/v1/orders", profile),
            ClientEndpointDefinition(orders, "/v1/sales", profile, measure="revenue", name="sales"),
        ]
    )
