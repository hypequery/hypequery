"""The demo's semantic model over the tables `seed.sql` creates."""

from __future__ import annotations

from hypequery.datasets import Dataset, dataset, dimension, formula, measure, resolved_rows

#: Every dataset is scoped by this column: a caller only ever reads its own tenant's rows.
TENANT_COLUMN = "tenant_id"


def orders() -> Dataset:
    """Orders on a ReplacingMergeTree: read resolved, so each order counts once."""

    return dataset(
        "orders",
        source="orders",
        description=(
            "Shop orders, one row per order at its latest version; deleted test orders "
            "are excluded."
        ),
        row_resolution=resolved_rows.replacing(deleted_column="is_deleted"),
        tenant_key=TENANT_COLUMN,
        time_key="created_at",
        dimensions={
            "order_id": dimension.string(groupable=False, description="Order identifier"),
            "country": dimension.string(description="Shipping country code"),
            "status": dimension.string(description="pending or paid"),
            "created_at": dimension.timestamp(description="When the order was placed (UTC)"),
        },
        measures={
            "orders": measure.count("order_id", description="Number of orders"),
            "revenue": measure.sum("amount", description="Order value in USD"),
            "customers": measure.count_distinct("customer_id", description="Exact distinct"),
            "revenue_7d": measure.trailing(
                "revenue", 7, "day", description="Revenue over the trailing 7 days"
            ),
            "revenue_prev_month": measure.shift(
                "revenue", 1, "month", description="Revenue in the previous month"
            ),
            "revenue_mom_growth": measure.derived(
                formula.divide(
                    formula.subtract("revenue", "revenue_prev_month"),
                    formula.null_if_zero("revenue_prev_month"),
                ),
                description="Month-over-month revenue growth, as a fraction",
            ),
        },
    )


def events() -> Dataset:
    """Raw product events, with an exact and an estimated distinct count side by side."""

    return dataset(
        "events",
        source="events",
        description="Product events: page views, searches, add-to-cart and checkouts.",
        tenant_key=TENANT_COLUMN,
        time_key="event_time",
        dimensions={
            "event": dimension.string(description="Event type"),
            "event_time": dimension.timestamp(description="When the event happened (UTC)"),
        },
        measures={
            "events": measure.count("user_id", description="Number of events"),
            "users": measure.count_distinct(
                "user_id", description="Exact distinct users (uniqExact)"
            ),
            "users_approx": measure.approx_count_distinct(
                "user_id", description="Estimated distinct users (uniq): cheaper, approximate"
            ),
            "users_7d": measure.trailing(
                "users", 7, "day", description="Distinct users over the trailing 7 days"
            ),
        },
    )


def daily_activity() -> Dataset:
    """Daily aggregate states on an AggregatingMergeTree, finished with -Merge."""

    return dataset(
        "daily_activity",
        source="daily_activity",
        description=(
            "Pre-aggregated daily activity. Distinct users merge across days, so a "
            "multi-day total counts each user once."
        ),
        tenant_key=TENANT_COLUMN,
        time_key="day",
        dimensions={"day": dimension.timestamp(description="Activity day (UTC)")},
        measures={
            "users": measure.merge(
                "uniq", "users_state", description="Estimated distinct users (uniqMerge)"
            ),
            "events": measure.merge("count", "events_state", description="Number of events"),
        },
    )


def demo_datasets() -> tuple[Dataset, ...]:
    return (orders(), events(), daily_activity())
