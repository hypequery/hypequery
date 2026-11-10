"""The semantic layer: measures and dimensions defined once, in Python.

Every Django view queries these names; none of them writes SQL.
"""

from hypequery.datasets import create_dataset_registry, dataset, dimension, filter, measure
from hypequery.datasets.formulas import divide, null_if_zero

events = dataset(
    "events",
    source="events",
    tenant_key="tenant_id",  # every query is scoped to the caller's tenant
    time_key="occurred_at",
    dimensions={
        "event_id": dimension.number(),
        "occurred_at": dimension.timestamp(),
        "user_id": dimension.number(),
        "event_type": dimension.string(label="Event type"),
        "path": dimension.string(label="Path"),
        "device": dimension.string(label="Device"),
        "status_code": dimension.number(label="HTTP status code"),
        "latency_ms": dimension.number(label="Latency (ms)"),
    },
    measures={
        "events": measure.count("event_id", label="Events"),
        "active_users": measure.count_distinct("user_id", label="Active users"),
        "errors": measure.count("event_id", filters=(filter.gte("status_code", 500),), label="Errors (5xx)"),
        "p95_latency_ms": measure.percentile("latency_ms", 0.95, label="p95 latency (ms)"),
        "error_rate": measure.derived(divide("errors", null_if_zero("events")), label="Error rate"),
    },
)

registry = create_dataset_registry(events)
