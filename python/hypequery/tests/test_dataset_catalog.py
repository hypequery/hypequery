"""PYB-05: registry and catalog generation.

The catalog is a cross-language contract, so the parity test below compares a
Python-built catalog against `specs/semantic-catalog/catalog.json` — the same
file the TypeScript suite checks itself against. The model is defined natively
in each language; only the catalog is shared, which is what makes drift in
either implementation fail on both sides.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetLimits,
    DatasetRegistry,
    FilterDefinition,
    arg_max,
    belongs_to,
    count,
    count_distinct,
    create_dataset_registry,
    dimension,
    eq,
    get_dataset_catalog,
    get_dataset_catalogs,
    get_groupable_relationship_fields,
    get_queryable_relationship_fields,
    has_many,
    has_one,
    measure,
    percentile,
    sum,  # noqa: A004
)

CATALOG_FIXTURE = (
    Path(__file__).resolve().parents[3] / "specs" / "semantic-catalog" / "catalog.json"
)

Customers = Dataset(
    name="customers",
    source="customers",
    dimensions={
        "id": dimension("string"),
        "country": dimension("string", label="Country", description="ISO country code"),
        "tier": dimension("string", column="customer_tier", groupable=False),
        "fullName": dimension(
            "string",
            sql="concat(first_name, ' ', last_name)",
            dependencies=("first_name", "last_name"),
        ),
    },
    measures={"customerCount": measure(count("id"))},
)

Orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "id": dimension("string"),
        "customerId": dimension("string", column="customer_id"),
        "status": dimension("string", label="Status", filterable=False),
        "createdAt": dimension("timestamp", column="created_at"),
        "amount": dimension("number"),
    },
    measures={
        "revenue": measure(sum("amount"), label="Revenue"),
        "orderCount": measure(count("id")),
        "uniqueCustomers": measure(count_distinct("customerId")),
        "topStatus": measure(arg_max("status", "amount")),
        "p95Amount": measure(percentile("amount", 0.95)),
        "paidRevenue": measure(sum("amount"), filters=(eq("status", "paid"),)),
    },
    filters={"status": FilterDefinition(field="status", operators=("eq", "in"))},
    relationships={
        "customer": belongs_to(Customers, from_field="customerId", to_field="id"),
        "primaryContact": has_one(Customers, from_field="id", to_field="id"),
        "relatedCustomers": has_many(Customers, from_field="id", to_field="id"),
    },
    limits=DatasetLimits(max_dimensions=5, max_filters=10, max_result_size=1000),
)


@pytest.fixture
def registry() -> DatasetRegistry:
    return create_dataset_registry(Customers, Orders)


def test_catalog_matches_the_shared_cross_language_fixture(registry: DatasetRegistry) -> None:
    expected = json.loads(CATALOG_FIXTURE.read_text())

    assert get_dataset_catalogs(registry) == expected


def test_catalog_json_round_trips_without_python_only_values(
    registry: DatasetRegistry,
) -> None:
    """The catalog must serialize as plain JSON, with no tuples or models left."""

    catalogs = get_dataset_catalogs(registry)
    encoded = json.dumps(catalogs, allow_nan=False)

    assert json.loads(encoded) == catalogs


def test_registry_rejects_a_duplicate_dataset_name() -> None:
    created = create_dataset_registry(Customers)

    with pytest.raises(ValueError, match="already registered"):
        created.register(Customers)


def test_registry_lookup_surface(registry: DatasetRegistry) -> None:
    assert registry.has("orders")
    assert registry.get("orders") is Orders
    assert registry.get("missing") is None
    assert [dataset.name for dataset in registry.get_all()] == ["customers", "orders"]

    with pytest.raises(ValueError, match="Unknown dataset"):
        registry.require("missing")


def test_a_relationship_to_an_unregistered_dataset_is_a_definition_error() -> None:
    lonely = create_dataset_registry(Orders)

    with pytest.raises(ValueError, match="Unknown dataset"):
        get_dataset_catalog(Orders, registry=lonely)


def test_sql_backed_and_non_groupable_dimensions_are_handled_separately(
    registry: DatasetRegistry,
) -> None:
    catalog = get_dataset_catalog(Orders, registry=registry)
    customer = catalog["relationships"]["customer"]

    # A SQL-backed target dimension cannot be joined through at all.
    assert "customer.fullName" not in customer["fields"]
    # A non-groupable one stays filterable, so it is queryable but not groupable.
    assert "customer.tier" in customer["fields"]
    assert "customer.tier" not in customer["groupableFields"]


def test_has_many_is_metadata_only(registry: DatasetRegistry) -> None:
    catalog = get_dataset_catalog(Orders, registry=registry)
    related = catalog["relationships"]["relatedCustomers"]

    assert related["queryable"] is False
    assert related["fields"] == []
    assert related["groupableFields"] == []
    assert "relatedCustomers.id" not in catalog["orderableFields"]


def test_relationship_field_helpers_read_the_catalog(registry: DatasetRegistry) -> None:
    catalog = get_dataset_catalog(Orders, registry=registry)

    assert get_queryable_relationship_fields(catalog) == [
        "customer.id",
        "customer.country",
        "customer.tier",
        "primaryContact.id",
        "primaryContact.country",
        "primaryContact.tier",
    ]
    assert get_groupable_relationship_fields(catalog) == [
        "customer.id",
        "customer.country",
        "primaryContact.id",
        "primaryContact.country",
    ]


def test_a_dataset_without_a_time_key_advertises_no_grains(
    registry: DatasetRegistry,
) -> None:
    catalog = get_dataset_catalog(Customers, registry=registry)

    assert catalog["supportedGrains"] == []
    assert catalog["requiresTenant"] is False
    assert "period" not in catalog["orderableFields"]
    assert "tenantKey" not in cast(dict[str, object], catalog)
    assert "maxLimit" not in cast(dict[str, object], catalog)


def test_default_filters_mirror_filterable_dimensions(registry: DatasetRegistry) -> None:
    customers = get_dataset_catalog(Customers, registry=registry)
    orders = get_dataset_catalog(Orders, registry=registry)

    # Customers declares no filters, so every filterable dimension gets one.
    assert sorted(customers["filters"]) == ["country", "fullName", "id", "tier"]
    assert customers["filters"]["id"]["operators"] == [
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "notIn",
        "between",
        "like",
    ]
    # Orders declares filters explicitly, so only those appear.
    assert list(orders["filters"]) == ["status"]
    assert orders["filters"]["status"]["operators"] == ["eq", "in"]
