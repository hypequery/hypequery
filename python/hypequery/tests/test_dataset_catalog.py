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
    SEMANTIC_CONTRACT_VERSION,
    SEMANTIC_FILTER_OPERATORS,
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
    serialize_semantic_contract,
    sum,  # noqa: A004
)
from hypequery.datasets.contract import contract_to_stable_json, hash_contract, normalize_sql

FIXTURES = Path(__file__).resolve().parents[3] / "specs" / "semantic-catalog"
CATALOG_FIXTURE = FIXTURES / "catalog.json"

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


def test_semantic_contract_matches_the_shared_fixture(registry: DatasetRegistry) -> None:
    """The contract hash is the cross-language artifact; it must agree exactly."""

    expected = json.loads((FIXTURES / "contract.json").read_text())

    assert serialize_semantic_contract(registry) == expected
    assert expected["version"] == SEMANTIC_CONTRACT_VERSION


def test_public_projection_matches_the_shared_fixture(registry: DatasetRegistry) -> None:
    expected = json.loads((FIXTURES / "contract-public.json").read_text())

    assert serialize_semantic_contract(registry, include_sql=False) == expected


def test_the_public_projection_withholds_internal_sql(registry: DatasetRegistry) -> None:
    trusted = serialize_semantic_contract(registry)
    published = serialize_semantic_contract(registry, include_sql=False)

    def full_name(contract: dict[str, object]) -> dict[str, object]:
        datasets = cast(dict[str, dict[str, object]], contract["datasets"])
        dimensions = cast(dict[str, dict[str, object]], datasets["customers"]["dimensions"])
        return dimensions["fullName"]

    assert "sql" in full_name(trusted)
    assert "sql" not in full_name(published)
    # A different projection is a different contract.
    assert trusted["contentHash"] != published["contentHash"]


def test_the_content_hash_covers_the_contract_without_itself(
    registry: DatasetRegistry,
) -> None:
    contract = serialize_semantic_contract(registry)
    unhashed = {key: value for key, value in contract.items() if key != "contentHash"}

    assert contract["contentHash"] == hash_contract(unhashed)
    assert list(contract) == ["version", "datasets", "contentHash"]
    assert contract_to_stable_json(unhashed).startswith('{\n  "version": 3,')


def test_the_hash_is_stable_across_authored_ordering() -> None:
    """Logically equal models must hash identically however they were authored."""

    def build(reverse: bool) -> dict[str, object]:
        names = ["b", "a"] if reverse else ["a", "b"]
        model = Dataset(
            name="t",
            source="t",
            dimensions={name: dimension("string") for name in names},
        )
        return serialize_semantic_contract(create_dataset_registry(model))

    assert build(False)["contentHash"] == build(True)["contentHash"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  sum(x)  ", "sum(x)"),
        ("\n\n  a\n  b\n\n", "a\nb"),
        ("    a\n      b", "a\n  b"),
        ("a  \nb\t", "a\nb"),
        ("a\r\nb", "a\nb"),
    ],
)
def test_sql_whitespace_is_normalized_before_hashing(raw: str, expected: str) -> None:
    assert normalize_sql(raw) == expected


def test_an_explicitly_empty_operator_set_is_published_as_empty() -> None:
    """An empty tuple says "no operator is allowed", and the catalog must say so.

    Truthiness would widen it to every operator, publishing a capability the
    planner refuses. JavaScript's empty array is truthy, so the reference
    catalog keeps it; Python has to check for absence explicitly.
    """

    dataset = Dataset(
        name="trips",
        source="trips",
        dimensions={"fare": dimension("number")},
        measures={"trips": measure(count("id"))},
        filters={"fare": FilterDefinition(field="fare", operators=())},
    )
    catalog = get_dataset_catalog(dataset, registry=create_dataset_registry(dataset))
    assert catalog["filters"]["fare"]["operators"] == []


def test_an_absent_operator_set_still_publishes_every_operator() -> None:
    dataset = Dataset(
        name="trips",
        source="trips",
        dimensions={"fare": dimension("number")},
        measures={"trips": measure(count("id"))},
        filters={"fare": FilterDefinition(field="fare")},
    )
    catalog = get_dataset_catalog(dataset, registry=create_dataset_registry(dataset))
    assert catalog["filters"]["fare"]["operators"] == list(SEMANTIC_FILTER_OPERATORS)
