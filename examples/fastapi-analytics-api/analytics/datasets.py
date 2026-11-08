"""The semantic layer: what the API can serve, defined once in Python."""

from hypequery.datasets import dataset, dimension, filter, measure
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
        "unique_users": measure.count_distinct("user_id", label="Active users"),
        "errors": measure.count("event_id", filters=(filter.gte("status_code", 500),), label="Errors (5xx)"),
        "p95_latency_ms": measure.percentile("latency_ms", 0.95, label="p95 latency (ms)"),
        # Derived measures are computed from other measures, so a ratio stays
        # correct however the query groups or filters.
        "error_rate": measure.derived(divide("errors", null_if_zero("events")), label="Error rate"),
    },
)

subscriptions = dataset(
    "subscriptions",
    source="subscriptions",
    tenant_key="tenant_id",
    time_key="started_at",
    dimensions={
        "subscription_id": dimension.number(),
        "plan": dimension.string(label="Plan"),
        "status": dimension.string(label="Status"),
        "billing_interval": dimension.string(label="Billing interval"),
        "started_at": dimension.timestamp(label="Started at"),
    },
    measures={
        "subscriptions": measure.count("subscription_id", label="Subscription periods"),
        "active_subscriptions": measure.count(
            "subscription_id", filters=(filter.eq("status", "active"),), label="Active subscriptions"
        ),
        "billed_amount": measure.sum("amount", label="Amount per billing interval"),
    },
)
