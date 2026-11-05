"""Pure definitions. No framework, auth or database imports."""

from hypequery.datasets import ClientQueryProfile, dataset, dimension, measure

orders = dataset(
    "orders",
    source="client_orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={"country": dimension.string()},
    measures={"revenue": measure.sum("amount"), "orderCount": measure.count("id")},
)
profile = ClientQueryProfile(default_limit=20, max_limit=100)
