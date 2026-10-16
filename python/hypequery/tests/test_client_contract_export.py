"""Definition-only client projection never executes or leaks physical details."""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    Dataset,
    DatasetLimits,
    FilterDefinition,
    Relationship,
    belongs_to,
    create_dataset_registry,
    dimension,
    export_client_contract,
    measure,
)
from hypequery.datasets.formulas import divide
from hypequery.protocol import ProtocolClientContractError, validate_protocol_client_query


def orders(*, limits: DatasetLimits | None = None) -> Dataset:
    return Dataset(
        name="orders",
        source="private_table_sentinel",
        tenant_key="private_tenant",
        time_key="private_timestamp",
        time_grains=("hour", "day"),
        dimensions={
            "country": dimension.string(column="private_column"),
            "amount": dimension.number(),
            "active": dimension.boolean(),
            "identity": dimension.string(column="private_tenant"),
            "computed": dimension.string(sql="private_sql_sentinel()"),
        },
        measures={
            "revenue": measure.sum("amount"),
            "count": measure.count("country"),
            "latest": measure.max("country"),
            "average": measure.derived(divide("revenue", "count")),
        },
        filters={
            "country": FilterDefinition(field="country", operators=("eq",)),
            "amount": FilterDefinition(field="amount"),
            "identity": FilterDefinition(field="identity"),
            "enabled": FilterDefinition(field="active"),
            "closed": FilterDefinition(field="country", operators=()),
        },
        limits=limits,
    )


def test_safe_projection_defaults_and_types() -> None:
    definition = ClientEndpointDefinition(orders(), "/api/orders", ClientQueryProfile())
    result = export_client_contract([definition], mount_path="/edge")
    endpoint = result["contract"]["endpoints"][0]
    assert endpoint["path"] == "/edge/api/orders"
    assert endpoint["defaultMeasures"] == ["revenue", "count", "latest"]
    assert endpoint["dimensions"]["amount"]["wireType"] == "number-or-string"
    assert endpoint["dimensions"]["country"]["nullable"] == "unknown"
    assert endpoint["measures"]["average"]["having"] is True
    assert endpoint["measures"]["latest"]["having"] is False
    assert endpoint["filters"]["enabled"]["operators"] == ["eq", "in", "neq", "notIn"]
    assert "identity" not in endpoint["filters"]
    assert "closed" not in endpoint["filters"]
    for secret in (
        "private_table_sentinel",
        "private_timestamp",
        "private_tenant",
        "private_column",
        "private_sql_sentinel",
    ):
        assert secret not in result["canonical"]
    plan = validate_protocol_client_query(result["contract"], "orders", {})
    assert plan["selectedMeasures"] == ["revenue", "count", "latest"]
    assert result == export_client_contract([definition], mount_path="/edge")
    with pytest.raises(FrozenInstanceError):
        definition.path = "/other"  # type: ignore[misc]


def test_metric_only_export_uses_public_output_alias() -> None:
    metric = ClientEndpointDefinition(
        orders(), "/metrics/revenue", ClientQueryProfile(), measure="revenue", name="sales"
    )
    result = export_client_contract([metric])
    endpoint = result["contract"]["endpoints"][0]
    assert endpoint["id"] == "sales"
    assert endpoint["dataset"] == "orders"
    assert endpoint["measures"] == {
        "sales": {"wireType": "string", "nullable": True, "having": False}
    }
    assert "defaultMeasures" not in endpoint
    plan = validate_protocol_client_query(
        result["contract"], "sales", {"dataset": "orders", "metric": "sales"}, "mcp"
    )
    assert plan["selectedMeasures"] == ["sales"]


def test_effective_limits_are_intersected_and_empty_defaults_refused() -> None:
    dataset = orders(
        limits=DatasetLimits(max_dimensions=2, max_measures=3, max_filters=4, max_result_size=5)
    )
    profile = ClientQueryProfile(max_limit=20, default_limit=10)
    endpoint = export_client_contract([ClientEndpointDefinition(dataset, "/orders", profile)])[
        "contract"
    ]["endpoints"][0]
    assert endpoint["limits"] == {
        "defaultLimit": 5,
        "maxLimit": 5,
        "maxOffset": 1_000_000,
        "maxDimensions": 2,
        "maxMeasures": 3,
        "maxPredicates": 4,
        "maxOrderBy": 100,
        "maxFilterValues": 10000,
    }
    with pytest.raises(ProtocolClientContractError):
        export_client_contract(
            [ClientEndpointDefinition(dataset, "/orders", ClientQueryProfile(max_measures=1))]
        )


def test_related_fields_apply_target_permissions_and_safe_measure_rules() -> None:
    target = Dataset(
        name="customers",
        source="private_customers",
        tenant_key="tenant_id",
        dimensions={
            "id": dimension.number(),
            "tier": dimension.string(),
            "active": dimension.boolean(groupable=False),
            "secret": dimension.string(filterable=False),
            "tenant": dimension.string(column="tenant_id"),
            "sql": dimension.string(sql="private_expr()"),
        },
        measures={"unique": measure.count_distinct("id"), "sum": measure.sum("id")},
    )
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"id": dimension.number()},
        measures={"total": measure.count("id")},
        filters={
            "alias": FilterDefinition(field="customer.tier", operators=("eq",)),
            "hidden": FilterDefinition(field="customer.secret"),
        },
        relationships={
            "customer": belongs_to(target, from_field="id", to_field="id"),
            "many": Relationship(kind="hasMany", target="unknown", from_field="id", to_field="id"),
        },
    )
    definition = ClientEndpointDefinition(dataset, "/orders", ClientQueryProfile())
    with pytest.raises(ValueError, match="registry"):
        export_client_contract([definition])
    registry = create_dataset_registry(dataset, target)
    endpoint = export_client_contract([definition], registry=registry)["contract"]["endpoints"][0]
    assert endpoint["dimensions"]["customer.tier"]["nullable"] is True
    assert endpoint["dimensions"]["customer.active"]["groupable"] is False
    assert "customer.sql" not in endpoint["dimensions"]
    assert "customer.secret" not in endpoint["filters"]
    assert "hidden" not in endpoint["filters"]
    assert "customer.tenant" not in endpoint["filters"]
    assert endpoint["filters"]["alias"]["operators"] == ["eq"]
    assert "customer.unique" in endpoint["measures"]
    assert "customer.sum" not in endpoint["measures"]
    assert endpoint["defaultMeasures"] == ["total"]


@pytest.mark.parametrize(
    "path", ["https://other/query", "/a/../query", "/query?x=1", "/{id}", "query"]
)
def test_paths_fail_closed_even_with_mount(path: str) -> None:
    with pytest.raises((ValueError, ProtocolClientContractError)):
        export_client_contract(
            [ClientEndpointDefinition(orders(), path, ClientQueryProfile())], mount_path="/edge"
        )


def test_empty_and_duplicate_exports() -> None:
    assert export_client_contract([])["contract"]["endpoints"] == []
    definition = ClientEndpointDefinition(orders(), "/orders", ClientQueryProfile())
    with pytest.raises(ProtocolClientContractError) as failure:
        export_client_contract([definition, definition])
    assert failure.value.code == "HQ_CLIENT_DUPLICATE"


def test_definition_export_imports_no_server_driver_and_opens_no_socket(tmp_path: Path) -> None:
    source = """
import socket
import sys
def guard(event, args):
    if event.startswith("socket."):
        raise AssertionError("network")
sys.addaudithook(guard)
from hypequery.datasets import ClientEndpointDefinition, ClientQueryProfile, export_client_contract
print(export_client_contract([])["canonical"])
assert "fastapi" not in sys.modules and "clickhouse_connect" not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", source], cwd=tmp_path, check=True, capture_output=True, text=True
    )
    assert json.loads(result.stdout)["kind"] == "hypequery-client-contract"


@pytest.mark.parametrize("name", ["orders", "country", "bad.name"])
def test_metric_id_and_alias_collisions_fail(name: str) -> None:
    with pytest.raises((ValueError, ProtocolClientContractError)):
        export_client_contract(
            [
                ClientEndpointDefinition(
                    orders(), "/metric", ClientQueryProfile(), measure="revenue", name=name
                )
            ]
        )


def test_unknown_measure_conflicting_registry_and_invalid_profile_fail() -> None:
    dataset = orders()
    with pytest.raises(ValueError, match="local"):
        export_client_contract(
            [ClientEndpointDefinition(dataset, "/metric", ClientQueryProfile(), measure="missing")]
        )
    other = Dataset(name="orders", source="different", dimensions={"country": dimension.string()})
    with pytest.raises(ValueError, match="registered"):
        export_client_contract(
            [ClientEndpointDefinition(dataset, "/orders", ClientQueryProfile())],
            registry=create_dataset_registry(other),
        )
    with pytest.raises(ProtocolClientContractError):
        export_client_contract(
            [ClientEndpointDefinition(dataset, "/orders", ClientQueryProfile(max_limit=0))]
        )
    with pytest.raises(ValueError, match="mount_path"):
        export_client_contract([], mount_path="/")
    with pytest.raises(ValueError, match="export ID"):
        export_client_contract(
            [ClientEndpointDefinition(dataset, "/orders", ClientQueryProfile(), name="wrong")]
        )
