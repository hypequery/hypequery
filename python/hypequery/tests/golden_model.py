"""The shared golden model: one registry exercising every definition feature.

Used by the golden SQL and golden projection snapshots, so a structural refactor
of either the compiler or the catalog/contract/deployment projections is checked
against the same definitions.
"""

from __future__ import annotations

from hypequery.datasets import (
    Dataset,
    DatasetLimits,
    ExecutionContext,
    FilterDefinition,
    belongs_to,
    create_dataset_registry,
    dimension,
    has_many,
    has_one,
    measure,
    tenant,
    tenants,
)
from hypequery.datasets import filter as f
from hypequery.datasets.formulas import (
    add,
    ceil,
    coalesce,
    divide,
    floor,
    multiply,
    null_if_zero,
    subtract,
)
from hypequery.datasets.formulas import (
    round as round_,
)
from hypequery.datasets.planner import all_tenants

Regions = Dataset(
    name="regions",
    source="geo.regions",
    tenant_key="tenant_id",
    dimensions={"code": dimension.string(), "label": dimension.string(column="region_label")},
    measures={"regionCount": measure.count_distinct("code")},
)

Customers = Dataset(
    name="customers",
    source="analytics.customers",
    tenant_key="tenant_id",
    dimensions={
        "id": dimension.string(),
        "country": dimension.string(),
        "tier": dimension.string(),
        "score": dimension.number(column="credit_score"),
        "hidden": dimension.string(groupable=False),
    },
    measures={
        "customerCount": measure.count_distinct("id"),
        "bestScore": measure.max("score"),
        "worstScore": measure.min("score"),
        "latestTier": measure.arg_max("tier", "score"),
        "goldCustomers": measure.count_distinct("id", filters=(f.eq("tier", "gold"),)),
        "scoreSum": measure.sum("score"),
    },
    relationships={"region": belongs_to(Regions, from_field="region_code", to_field="code")},
)

Profiles = Dataset(
    name="profiles",
    source="analytics.profiles",
    dimensions={"customer_id": dimension.string(), "plan": dimension.string()},
    measures={"profileAge": measure.avg("age_days"), "profileCount": measure.count("plan")},
)

Accounts = Dataset(
    name="accounts",
    source="analytics.accounts",
    dimensions={"name": dimension.string(), "_hq_match": dimension.string()},
    measures={"accountCount": measure.count_distinct("name")},
)

Orders = Dataset(
    name="orders",
    source="analytics.orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "status": dimension.string(),
        "amount": dimension.number(column="net_amount"),
        "paid": dimension.boolean(),
        "created": dimension.timestamp(column="created_at"),
        "created_at": dimension.timestamp(),
        "customer_id": dimension.string(),
        "channel": dimension.string(filterable=False),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orders": measure.count("status"),
        "uniqueCustomers": measure.count_distinct("customer_id"),
        "avgAmount": measure.avg("amount"),
        "minAmount": measure.min("amount"),
        "maxAmount": measure.max("amount"),
        "medianAmount": measure.median("amount"),
        "p95Amount": measure.percentile("amount", 0.95),
        "spread": measure.stddev("amount"),
        "variance": measure.variance("amount"),
        "lastStatus": measure.arg_max("status", "created_at"),
        "firstStatus": measure.arg_min("status", "created_at"),
        "paidRevenue": measure.sum("amount", filters=(f.eq("status", "paid"), f.gte("amount", 10))),
        "goldRevenue": measure.sum("amount", filters=(f.eq("customer.tier", "gold"),)),
        "paidP90": measure.percentile("amount", 0.9, filters=(f.eq("status", "paid"),)),
        "paidCustomers": measure.count_distinct(
            "customer_id", filters=(f.in_list("status", ["paid", "settled"]),)
        ),
        "average": measure.derived(divide("revenue", null_if_zero("orders"))),
        "rounded": measure.derived(round_("average", 2)),
        "paidShare": measure.derived(coalesce(divide("paidRevenue", null_if_zero("revenue")), 0)),
        "net": measure.derived(subtract(multiply("revenue", 0.9), add("orders", -1))),
        "bounds": measure.derived(add(floor("avgAmount"), ceil("avgAmount"))),
        "big": measure.derived(multiply("orders", 70000)),
        "nothing": measure.derived(coalesce("revenue", None)),
    },
    filters={
        "status": FilterDefinition(field="status"),
        "amount": FilterDefinition(field="amount"),
        "paid": FilterDefinition(field="paid"),
        "created": FilterDefinition(field="created"),
        "created_at": FilterDefinition(field="created_at"),
        "statusOnly": FilterDefinition(field="status", operators=("eq", "in")),
        "customer_id": FilterDefinition(field="customer_id"),
    },
    relationships={
        "customer": belongs_to(Customers, from_field="customer_id", to_field="id"),
        "profile": has_one(Profiles, from_field="customer_id", to_field="customer_id"),
        "lines": has_many(Profiles, from_field="id", to_field="order_id"),
        "account": belongs_to(
            Accounts, keys=(("account_name", "name"), ("account_region", "region"))
        ),
    },
)

Events = Dataset(
    name="events",
    source="events",
    time_key="ts",
    time_grains=("hour", "day", "week", "month", "quarter", "year", "minute"),
    dimensions={
        "kind": dimension.string(),
        "ts": dimension.timestamp(),
        "doubled": dimension.number(sql="value * 2", dependencies=("value",)),
    },
    measures={
        "events": measure.count("kind"),
        "total": measure.sum("value"),
        "rawTotal": measure.sum("value", sql="value * 2", dependencies=("value",)),
    },
    limits=DatasetLimits(max_result_size=500),
)

REGISTRY = create_dataset_registry(Orders, Customers, Regions, Profiles, Accounts, Events)
ACME = ExecutionContext(tenant=tenant("acme"))
SEVERAL = ExecutionContext(tenant=tenants(("acme", "globex")))
ALL = ExecutionContext(tenant=all_tenants())
