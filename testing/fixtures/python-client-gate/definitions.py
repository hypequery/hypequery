"""Pure additional semantic cases for the installed client release gate."""

from examples.client_dashboard.definitions import orders, profile
from hypequery.datasets import (
    ClientEndpointDefinition,
    create_dataset_registry,
    dataset,
    dimension,
    export_client_contract,
    has_one,
    measure,
)
from hypequery.protocol import PreparedProtocolClientContract

profiles = dataset(
    "profiles",
    source="client_profiles",
    tenant_key="org_id",
    dimensions={"id": dimension.number(), "label": dimension.string()},
    measures={"total": measure.sum("score"), "minimum": measure.min("score")},
)
joined = dataset(
    "joinedOrders",
    source="client_orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount")},
    relationships={"profile": has_one(profiles, from_field="id", to_field="id")},
)


def build() -> PreparedProtocolClientContract:
    return export_client_contract(
        [
            ClientEndpointDefinition(orders, "/v1/orders", profile),
            ClientEndpointDefinition(
                orders, "/v1/sales", profile, measure="revenue", name="sales"
            ),
            ClientEndpointDefinition(joined, "/v1/joined", profile),
        ],
        registry=create_dataset_registry(orders, joined, profiles),
    )
