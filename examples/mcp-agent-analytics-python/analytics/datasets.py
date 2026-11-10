"""What the agent is allowed to ask about.

The dataset descriptions reach the agent through `list_datasets`; field names
and types reach it through `get_dataset_schema`, so name fields plainly. Both
datasets carry `tenant_key`, so every query is scoped to the tenant the server
process was started for.
"""

from hypequery.datasets import dataset, dimension, filter, measure
from hypequery.datasets.formulas import divide, null_if_zero

events = dataset(
    "events",
    source="events",
    description="Product events: page views, API calls, query runs, logins, exports and errors.",
    tenant_key="tenant_id",
    time_key="occurred_at",
    dimensions={
        "event_id": dimension.number(),
        "occurred_at": dimension.timestamp(label="Occurred at"),
        "user_id": dimension.number(),
        "event_type": dimension.string(
            label="Event type", description="page_view, api_call, query_run, login, export or error"
        ),
        "path": dimension.string(label="Path", description="Page or API path the event hit"),
        "device": dimension.string(label="Device", description="desktop, mobile, tablet or api"),
        "status_code": dimension.number(label="HTTP status code"),
        "latency_ms": dimension.number(label="Latency (ms)"),
    },
    measures={
        "events": measure.count("event_id", label="Events", description="Number of events"),
        "unique_users": measure.count_distinct(
            "user_id", label="Active users", description="Distinct users with at least one event"
        ),
        "errors": measure.count("event_id", filters=(filter.gte("status_code", 500),), label="Errors (5xx)"),
        "error_rate": measure.derived(
            divide("errors", null_if_zero("events")), label="Error rate", description="Errors / events, 0 to 1"
        ),
        "p95_latency_ms": measure.percentile("latency_ms", 0.95, label="p95 latency (ms)"),
    },
)

subscriptions = dataset(
    "subscriptions",
    source="subscriptions",
    description="Subscriptions per plan and billing interval, with status and billed amount.",
    tenant_key="tenant_id",
    time_key="started_at",
    dimensions={
        "subscription_id": dimension.number(),
        "plan": dimension.string(label="Plan", description="starter, growth or enterprise"),
        "status": dimension.string(label="Status", description="active, trialing, past_due or canceled"),
        "billing_interval": dimension.string(label="Billing interval", description="monthly or annual"),
        "started_at": dimension.timestamp(label="Started at"),
    },
    measures={
        "subscriptions": measure.count("subscription_id", label="Subscription periods"),
        "billed_amount": measure.sum("amount", label="Amount per billing interval"),
    },
)
