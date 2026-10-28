"""The example's dataset definitions: the orders table seed.sql creates."""

from hypequery.datasets import dataset, dimension, measure

orders = dataset(
    "orders",
    source="orders",
    time_key="created_at",
    dimensions={
        "id": dimension.string(),
        "country": dimension.string(),
        "status": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
    },
)

datasets = {"orders": orders}
