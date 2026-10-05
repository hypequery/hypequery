"""Composite relationship equality keys (RFC 0016), at parity with TypeScript."""

from __future__ import annotations

import copy
import os
import re
import secrets
from typing import cast

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    ExecutionContext,
    Relationship,
    RelationshipKey,
    asc,
    belongs_to,
    count_distinct,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    eq,
    get_dataset_catalog,
    has_many,
    has_one,
    measure,
    min,  # noqa: A004
    tenant,
)
from hypequery.datasets import sum as sum_
from hypequery.datasets.contract import serialize_semantic_contract
from hypequery.datasets.deployment import build_protocol_dataset_contract
from hypequery.datasets.planner import plan_dataset_query
from hypequery.protocol import ProtocolDeploymentError, ProtocolIdentifierError
from hypequery.protocol.deployments import validate_protocol_dataset_contract

KEYS = [{"from": "customer_id", "to": "id"}, {"from": "region_code", "to": "region"}]

Customers = Dataset(
    name="compositeCustomers",
    source="customers",
    tenant_key="tenant",
    dimensions={"id": dimension("number"), "name": dimension("string")},
    measures={"minimum": measure(min("score"))},
)
Orders = Dataset(
    name="compositeOrders",
    source="orders",
    dimensions={"status": dimension("string")},
    measures={"revenue": measure(sum_("amount"))},
    relationships={
        "customer": belongs_to(
            lambda: Customers, keys=(("customer_id", "id"), ("region_code", "region"))
        )
    },
)
REGISTRY = create_dataset_registry(Orders, Customers)
CONTEXT = ExecutionContext(tenant=tenant("a"))


def _sql(query: DatasetQuery) -> str:
    return plan_dataset_query(Orders, query, registry=REGISTRY, context=CONTEXT).sql


def test_every_pair_joins_with_and_and_the_tenant_stays_a_parameter() -> None:
    sql = _sql(
        DatasetQuery(
            dimensions=("customer.name",),
            measures=("revenue",),
            filters=(eq("customer.name", "Ada"),),
        )
    )
    assert re.search(
        r"ON `__hq_base`\.`customer_id` = `customer`\.`id` AND "
        r"`__hq_base`\.`region_code` = `customer`\.`region` AND "
        r"`customer`\.`tenant` = \{p\d+:String\}",
        sql,
    )
    assert sql.count("LEFT ANY JOIN") == 1


def test_related_measures_project_every_target_key() -> None:
    sql = _sql(DatasetQuery(measures=("customer.minimum",)))
    assert "(SELECT `id`, `region`, `tenant`," in sql
    assert "`__hq_base`.`region_code` = `customer`.`region`" in sql
    assert "isNotNull(`customer`.`_hq_match`)" in sql


def test_keys_accept_relationship_key_models_and_are_snapshotted() -> None:
    authored = [
        RelationshipKey(from_field="customer_id", to_field="id"),
        ("region_code", "region"),
    ]
    relationship = has_one(lambda: Customers, keys=authored)  # type: ignore[arg-type]
    authored.pop()
    assert relationship.keys == Orders.relationships["customer"].keys
    assert (relationship.from_field, relationship.to_field) == ("customer_id", "id")
    assert type(relationship.keys) is tuple


def test_a_single_key_keeps_its_legacy_shape() -> None:
    legacy = belongs_to(lambda: Customers, from_field="customer_id", to_field="id")
    assert legacy.keys is None
    assert legacy.key_pairs == (RelationshipKey(from_field="customer_id", to_field="id"),)
    portable = build_protocol_dataset_contract(
        Dataset(name="o", source="o", dimensions={}, relationships={"c": legacy})
    )
    assert "keys" not in cast(list[dict[str, object]], portable["relationships"])[0]


@pytest.mark.parametrize(
    ("options", "error"),
    [
        ({"keys": ()}, ValueError),
        ({"keys": (("id", "id"),), "from_field": "id", "to_field": "id"}, TypeError),
        ({"keys": (("id; DROP TABLE x", "id"),)}, ProtocolIdentifierError),
        ({"keys": (("id", "x.id"),)}, ProtocolIdentifierError),
        ({"keys": (("id", "id"), ("id", "region"))}, ValidationError),
        ({"keys": (("id", "id"), ("region", "id"))}, ValidationError),
        ({"keys": (("id",),)}, TypeError),
        ({"keys": "id"}, TypeError),
        ({"from_field": "id"}, TypeError),
    ],
)
def test_malformed_keys_are_rejected(options: dict[str, object], error: type[Exception]) -> None:
    with pytest.raises(error):
        belongs_to(lambda: Customers, **options)  # type: ignore[arg-type]


def test_the_first_key_must_mirror_from_and_to() -> None:
    with pytest.raises(ValidationError, match="first relationship key"):
        Relationship(
            kind="belongsTo",
            target="customers",
            from_field="other",
            to_field="id",
            keys=(RelationshipKey(from_field="customer_id", to_field="id"),),
        )


def test_catalog_contract_and_deployment_carry_complete_keys() -> None:
    assert (
        get_dataset_catalog(Orders, registry=REGISTRY)["relationships"]["customer"].get("keys")
        == KEYS
    )
    contract = serialize_semantic_contract(REGISTRY)
    datasets = contract["datasets"]
    assert datasets["compositeOrders"]["relationships"]["customer"]["keys"] == KEYS  # type: ignore[index]
    portable = build_protocol_dataset_contract(Orders)
    assert portable["relationships"] == [
        {
            "name": "customer",
            "kind": "belongsTo",
            "target": "compositeCustomers",
            "from": "customer_id",
            "to": "id",
            "keys": KEYS,
            "queryable": True,
        }
    ]
    # A single authored pair serializes exactly like from_field/to_field.
    single = Dataset(
        name="singleKeyOrders",
        source="orders",
        dimensions={"status": dimension("string")},
        relationships={
            "by_keys": has_many(lambda: Customers, keys=(("customer_id", "id"),)),
            "by_fields": has_many(lambda: Customers, from_field="customer_id", to_field="id"),
        },
    )
    assert single.relationships["by_keys"] == single.relationships["by_fields"]
    entries = cast(
        list[dict[str, object]], build_protocol_dataset_contract(single)["relationships"]
    )
    by_name = {entry["name"]: entry for entry in entries}
    assert {**by_name["by_keys"], "name": "by_fields"} == by_name["by_fields"]


def _relationship(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "name": "customer",
        "kind": "belongsTo",
        "target": "customers",
        "from": "customer_id",
        "to": "id",
        "queryable": True,
        "keys": [{"from": "customer_id", "to": "id"}, {"from": "region", "to": "region"}],
    }
    base.update(overrides)
    return base


def _contract(relationship: dict[str, object]) -> dict[str, object]:
    return {
        "name": "orders",
        "source": "orders",
        "tenant": {"kind": "not-required"},
        "dimensions": [],
        "measures": [],
        "filters": [],
        "metrics": [],
        "relationships": [relationship],
    }


def test_protocol_validates_composite_keys() -> None:
    relationship = _relationship()
    validated = validate_protocol_dataset_contract(_contract(relationship))
    assert validated["relationships"][0]["keys"] == relationship["keys"]  # type: ignore[index]


@pytest.mark.parametrize(
    ("keys", "code", "path"),
    [
        ([], "HQ_DEPLOYMENT_INVALID_VALUE", "$.relationships[0].keys"),
        ([{"from": "other", "to": "id"}], "HQ_DEPLOYMENT_INVALID_VALUE", "$.relationships[0].keys"),
        (
            [{"from": "customer_id", "to": "id"}, {"from": "region", "to": "id"}],
            "HQ_DEPLOYMENT_INVALID_VALUE",
            "$.relationships[0].keys",
        ),
        (
            [{"from": "customer_id", "to": "id"}, {"from": "bad;sql", "to": "region"}],
            "HQ_DEPLOYMENT_INVALID_IDENTIFIER",
            "$.relationships[0].keys[1].from",
        ),
        (
            [{"from": "customer_id", "to": "id", "extra": 1}],
            "HQ_DEPLOYMENT_UNKNOWN_FIELD",
            "$.relationships[0].keys[0].extra",
        ),
        ("customer_id", "HQ_DEPLOYMENT_TYPE", "$.relationships[0].keys"),
    ],
)
def test_protocol_rejects_malformed_keys(keys: object, code: str, path: str) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_dataset_contract(_contract(_relationship(keys=keys)))
    assert (raised.value.code, raised.value.path) == (code, path)


@pytest.mark.parametrize("field", ["from", "to"])
@pytest.mark.parametrize("index", [0, 1])
def test_protocol_rejects_qualified_composite_columns(field: str, index: int) -> None:
    keys = [{"from": "customer_id", "to": "id"}, {"from": "region", "to": "region"}]
    keys[index][field] = f"orders.{keys[index][field]}"
    relationship = _relationship(keys=keys, **keys[0])
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_dataset_contract(_contract(relationship))
    assert raised.value.code == "HQ_DEPLOYMENT_INVALID_IDENTIFIER"


def test_protocol_keeps_the_legacy_qualified_grammar() -> None:
    legacy = _relationship(**{"from": "orders.customer_id"})
    del legacy["keys"]
    validated = validate_protocol_dataset_contract(_contract(legacy))
    assert validated["relationships"][0]["from"] == "orders.customer_id"  # type: ignore[index]


def test_protocol_bounds_the_key_array() -> None:
    from hypequery.protocol import ProtocolDeploymentLimits

    relationship = _relationship()
    keys = copy.deepcopy(relationship["keys"])
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_dataset_contract(
            _contract(relationship), limits=ProtocolDeploymentLimits(max_dataset_items=1)
        )
    assert raised.value.code == "HQ_DEPLOYMENT_TOO_MANY_ITEMS"
    assert relationship["keys"] == keys


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_the_full_key_matches_and_null_components_never_do() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    admin = clickhouse_connect.get_client(
        host=host, port=port, username="default", password=password
    )
    # A fresh name, created without IF NOT EXISTS: the test only ever drops
    # the database it created itself.
    database = f"hq_composite_relationships_{secrets.token_hex(6)}"
    admin.command(f"CREATE DATABASE {database}")
    admin.command(
        f"CREATE TABLE {database}.customers "
        "(id Nullable(UInt64), region Nullable(String), row_key String, score Float64, "
        "tier String, tenant String) ENGINE = Memory"
    )
    admin.command(
        f"CREATE TABLE {database}.orders (customer_id Nullable(UInt64), "
        "region_code Nullable(String), amount Float64, status String, tenant String) "
        "ENGINE = Memory"
    )
    admin.command(
        f"INSERT INTO {database}.customers VALUES "  # noqa: S608 - generated name
        "(1, 'US', '1US', 5, 'gold', 'a'), (1, 'EU', '1EU', 10, 'silver', 'a'), "
        "(1, 'EU', '1EU-b', 900, 'secret', 'b'), (NULL, 'EU', 'nullEU', 999, 'null-id', 'a'), "
        "(1, NULL, '1null', 999, 'null-region', 'a')"
    )
    admin.command(
        f"INSERT INTO {database}.orders VALUES "  # noqa: S608 - generated name
        "(1, 'US', 10, 'paid', 'a'), (1, 'US', 20, 'paid', 'a'), (1, 'EU', 30, 'paid', 'a'), "
        "(1, 'AP', 40, 'missing', 'a'), (NULL, 'EU', 50, 'null', 'a'), "
        "(1, NULL, 60, 'null', 'a'), (1, 'EU', 900, 'paid', 'b')"
    )
    targets = Dataset(
        name="liveCustomers",
        source="customers",
        tenant_key="tenant",
        dimensions={"tier": dimension("string")},
        measures={
            "count": measure(count_distinct("row_key")),
            "lowest": measure(min("score")),
        },
    )
    sources = Dataset(
        name="liveOrders",
        source="orders",
        tenant_key="tenant",
        dimensions={"status": dimension("string")},
        measures={"revenue": measure(sum_("amount"))},
        relationships={
            "customer": belongs_to(
                lambda: targets, keys=(("customer_id", "id"), ("region_code", "region"))
            )
        },
    )
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=host,
            port=port,
            database=database,
            username="default",
            password=password,
        )
    )
    try:
        client = create_dataset_client(
            executor=executor, registry=create_dataset_registry(sources, targets)
        )
        grouped = client.execute(
            "liveOrders",
            DatasetQuery(
                dimensions=("customer.tier",),
                measures=("revenue", "customer.count"),
                order_by=(asc("customer.tier"),),
            ),
            context=CONTEXT,
        ).data
        matched = [row for row in grouped if row["customer.count"] != 0]
        assert matched == [
            {"customer.tier": "gold", "revenue": 30.0, "customer.count": 1},
            {"customer.tier": "silver", "revenue": 30.0, "customer.count": 1},
        ]
        # Unmatched orders keep their revenue under the empty default tier.
        assert sum(row["revenue"] for row in grouped) == 210.0  # type: ignore[misc]
        assert not {"secret", "null-id", "null-region"} & {row["customer.tier"] for row in grouped}

        filtered = client.execute(
            "liveOrders",
            DatasetQuery(measures=("revenue",), filters=(eq("customer.tier", "silver"),)),
            context=CONTEXT,
        ).data
        assert filtered == ({"revenue": 30.0},)

        related = client.execute(
            "liveOrders",
            DatasetQuery(measures=("customer.count", "customer.lowest")),
            context=CONTEXT,
        ).data
        assert related == ({"customer.count": 2, "customer.lowest": 5.0},)
    finally:
        executor.close()
        admin.command(f"DROP DATABASE IF EXISTS {database}")
        admin.close()
