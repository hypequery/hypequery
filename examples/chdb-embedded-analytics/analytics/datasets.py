"""The semantic layer, defined once. Nothing here knows whether it runs on
chDB inside this process or on a ClickHouse server: sources are table names."""

from hypequery.datasets import belongs_to, dataset, dimension, filter, measure
from hypequery.datasets.formulas import divide, null_if_zero

tenants = dataset(
    "tenants",
    source="tenants",
    dimensions={
        "tenant_id": dimension.number(),
        "name": dimension.string(label="Tenant"),
        "plan": dimension.string(label="Plan"),
        "region": dimension.string(label="Region"),
        "industry": dimension.string(label="Industry"),
    },
)

events = dataset(
    "events",
    source="events",
    time_key="occurred_at",
    dimensions={
        "occurred_at": dimension.timestamp(),
        "tenant_id": dimension.number(),
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
        # Derived from other measures, so the ratio is right at any grouping.
        "error_rate": measure.derived(divide("errors", null_if_zero("events")), label="Error rate"),
    },
    # `tenant.plan`, `tenant.region`, ... become dimensions through a join.
    relationships={"tenant": belongs_to(tenants, from_field="tenant_id", to_field="tenant_id")},
)
