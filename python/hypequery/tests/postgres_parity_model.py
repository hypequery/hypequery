"""Datasets and rows shared by the Postgres live and parity suites.

The model is built over one schema name, so the same definitions read a
ClickHouse database and a Postgres schema of that name. The rows are
generated from a fixed seed, so both engines hold exactly the same data.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta

from hypequery.datasets import (
    Dataset,
    FilterDefinition,
    belongs_to,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets import filter as f
from hypequery.datasets.formulas import coalesce, divide, null_if_zero
from hypequery.datasets.formulas import round as round_
from hypequery.datasets.registry import DatasetRegistry

STATUSES = ("paid", "shipped", "refunded", "paid's \\ quote", None)
REGIONS = ("eu", "us", "apac", "EU", "US")
COUNTRIES = ("DE", "US", "JP", "FR", "BR")


def build_model(schema: str) -> tuple[Dataset, Dataset, DatasetRegistry]:
    customers = Dataset(
        name="customers",
        source=f"{schema}.customers",
        tenant_key="tenant_id",
        dimensions={
            "id": dimension.number(column="customer_id"),
            "country": dimension.string(column="country_code"),
            "tier": dimension.string(),
            "score": dimension.number(),
        },
        measures={
            "customerCount": measure.count_distinct("id"),
            "bestScore": measure.max("score"),
            "goldCustomers": measure.count_distinct("id", filters=(f.eq("tier", "gold"),)),
        },
    )
    orders = Dataset(
        name="orders",
        source=f"{schema}.orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={
            "status": dimension.string(),
            "region": dimension.string(column="region_code"),
            "gift": dimension.boolean(column="is_gift"),
            "amount": dimension.number(column="amount_cents"),
            "customer_id": dimension.number(),
            "created_at": dimension.timestamp(),
        },
        measures={
            "revenue": measure.sum("amount"),
            "orders": measure.count("status"),
            "buyers": measure.count_distinct("customer_id"),
            "avgAmount": measure.avg("amount"),
            "minAmount": measure.min("amount"),
            "maxAmount": measure.max("amount"),
            "p95": measure.percentile("amount", 0.95),
            "median": measure.median("amount"),
            "spread": measure.stddev("amount"),
            "variance": measure.variance("amount"),
            "topRegion": measure.arg_max("region", "amount"),
            "bottomRegion": measure.arg_min("region", "amount"),
            "paidRevenue": measure.sum("amount", filters=(f.eq("status", "paid"),)),
            "giftOrders": measure.count("status", filters=(f.eq("gift", True),)),
            "paidP90": measure.percentile("amount", 0.9, filters=(f.eq("status", "paid"),)),
            "euBuyers": measure.count_distinct(
                "customer_id", filters=(f.in_list("region", ["eu", "EU"]),)
            ),
            "average": measure.derived(divide("revenue", null_if_zero("orders"))),
            "rounded": measure.derived(round_("average", 2)),
            "paidShare": measure.derived(
                coalesce(divide("paidRevenue", null_if_zero("revenue")), 0)
            ),
            "unguarded": measure.derived(divide("revenue", "giftOrders")),
        },
        filters={
            "status": FilterDefinition(field="status"),
            "region": FilterDefinition(field="region"),
            "amount": FilterDefinition(field="amount"),
            "gift": FilterDefinition(field="gift"),
            "created_at": FilterDefinition(field="created_at"),
        },
        relationships={
            "customer": belongs_to(customers, from_field="customer_id", to_field="customer_id"),
        },
    )
    return orders, customers, create_dataset_registry(orders, customers)


def order_rows(count: int = 1200) -> list[dict[str, object]]:
    rng = random.Random(20261026)  # noqa: S311 - seeded test data, not a secret
    start = datetime(2025, 1, 1, tzinfo=UTC)
    span = (datetime(2026, 4, 15, tzinfo=UTC) - start).total_seconds()
    rows: list[dict[str, object]] = [
        {
            "tenant_id": "acme" if rng.random() < 0.9 else "other",
            "customer_id": None if rng.random() < 0.05 else 1 + rng.randrange(40),
            "status": rng.choice(STATUSES),
            "region_code": rng.choice(REGIONS),
            "is_gift": rng.random() < 0.2,
            "amount_cents": rng.randrange(50_000),
            "created_at": start + timedelta(milliseconds=int(rng.random() * span * 1000)),
        }
        for _ in range(count)
    ]
    # The New York DST transitions: 2026-03-08 07:00Z, and 2025-11-02 05:00Z-07:00Z,
    # when 01:00-02:00 local happens twice.
    instants = (
        "2026-03-08T06:30:00",
        "2026-03-08T07:30:00",
        "2025-11-02T05:30:00",
        "2025-11-02T06:30:00",
        "2026-01-01T00:00:00",
        "2025-12-31T23:59:59.999",
    )
    rows.extend(
        {
            "tenant_id": "acme",
            "customer_id": 7,
            "status": "paid",
            "region_code": "us",
            "is_gift": False,
            "amount_cents": 1234,
            "created_at": datetime.fromisoformat(instant).replace(tzinfo=UTC),
        }
        for instant in instants
    )
    return rows


def customer_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for customer in range(1, 41):
        row = {
            "customer_id": customer,
            "tenant_id": "acme",
            "country_code": COUNTRIES[customer % len(COUNTRIES)],
            "tier": "gold" if customer % 3 == 0 else "silver",
            "score": float(customer * 7 % 101),
        }
        rows.append(row)
        # A duplicated key with identical attributes: a single-match join may pick either.
        if customer % 7 == 0:
            rows.append(dict(row))
    rows.append(
        {"customer_id": 1, "tenant_id": "other", "country_code": "FR", "tier": "gold", "score": 1.0}
    )
    return rows
