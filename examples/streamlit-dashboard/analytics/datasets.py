"""The semantic layer: every number on the dashboard is defined here, once.

The dashboard asks for measures and dimensions by name and never writes SQL,
so "active users" or "error rate" means the same thing on every chart, in the
CSV export, and in any other app that imports these datasets.
"""

from hypequery.datasets import belongs_to, dataset, dimension, filter, measure
from hypequery.datasets.formulas import divide, null_if_zero

tenants = dataset(
    "tenants",
    source="tenants",
    tenant_key="tenant_id",
    dimensions={
        "tenant_id": dimension.number(label="Tenant id"),
        "name": dimension.string(label="Tenant"),
        "plan": dimension.string(label="Plan"),
        "region": dimension.string(label="Region"),
        "industry": dimension.string(label="Industry"),
    },
    measures={"tenants": measure.count_distinct("tenant_id", label="Tenants")},
)

events = dataset(
    "events",
    source="events",
    tenant_key="tenant_id",
    time_key="occurred_at",
    dimensions={
        "occurred_at": dimension.timestamp(label="Occurred at"),
        "event_type": dimension.string(label="Event type"),
        "path": dimension.string(label="Path"),
        "device": dimension.string(label="Device"),
        "status_code": dimension.number(label="HTTP status code"),
    },
    measures={
        "events": measure.count("event_id", label="Events"),
        "active_users": measure.count_distinct("user_id", label="Active users"),
        "errors": measure.count("event_id", filters=(filter.gte("status_code", 500),), label="Errors (5xx)"),
        "p95_latency_ms": measure.percentile("latency_ms", 0.95, label="p95 latency (ms)"),
        "error_rate": measure.derived(divide("errors", null_if_zero("events")), label="Error rate"),
    },
    # Breakdowns by tenant.plan / tenant.region join the tenants table.
    relationships={"tenant": belongs_to(lambda: tenants, from_field="tenant_id", to_field="tenant_id")},
)
