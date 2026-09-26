"""Python-authored datasets produce complete, deterministic Cloud artifacts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.datasets import (
    Dataset,
    belongs_to,
    build_protocol_dataset_contract,
    build_protocol_deployment_contract,
    create_dataset_registry,
    dimension,
    eq,
    measure,
    prepare_dataset_bundle,
    sum,  # noqa: A004
    write_dataset_bundle,
)
from hypequery.protocol import (
    prepare_protocol_deployment_bundle_manifest,
    prepare_protocol_deployment_contract,
)


def _model() -> tuple[Dataset, Dataset]:
    customers = Dataset(
        name="customers",
        source="analytics.customers",
        dimensions={"id": dimension("string"), "region": dimension("string")},
    )
    orders = Dataset(
        name="orders",
        source="analytics.orders",
        tenant_key="tenant_id",
        dimensions={
            "id": dimension("string"),
            "amount": dimension("number"),
            "status": dimension("string"),
        },
        measures={"revenue": measure(sum("amount"), filters=(eq("status", "paid"),))},
        relationships={"customer": belongs_to(customers, from_field="customer_id", to_field="id")},
    )
    return customers, orders


def _endpoint() -> dict[str, object]:
    return {
        "access": {"kind": "authenticated", "roles": ["analyst"], "scopes": []},
        "tenant": {"kind": "required", "mode": "auto-inject", "column": "tenant_id"},
        "path": "/api/analytics/datasets/orders/query",
    }


def test_definition_to_contract_preserves_policy_relationship_and_measure_filter() -> None:
    customers, orders = _model()
    registry = create_dataset_registry(orders, customers)
    contract = build_protocol_deployment_contract(registry, endpoints={"orders": _endpoint()})

    datasets = cast(list[dict[str, object]], contract["datasets"])
    assert [item["name"] for item in datasets] == ["customers", "orders"]
    supporting, exposed = datasets
    assert "endpoint" not in supporting
    assert exposed["endpoint"] == _endpoint()
    assert exposed["tenant"] == {"kind": "required", "field": "tenant_id"}
    assert exposed["relationships"] == [
        {
            "name": "customer",
            "kind": "belongsTo",
            "target": "customers",
            "from": "customer_id",
            "to": "id",
            "queryable": True,
        }
    ]
    measures = cast(list[dict[str, object]], exposed["measures"])
    assert measures[0]["filters"] == [
        {
            "kind": "comparison",
            "operator": "eq",
            "left": {"kind": "reference", "name": "status"},
            "right": {"kind": "literal", "value": "paid"},
        }
    ]
    assert "metrics" not in exposed


def test_sql_fields_require_dependencies_before_emitting_a_contract() -> None:
    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"gross": dimension("number", sql="net + tax")},
    )
    with pytest.raises(ValueError, match="must declare dependencies"):
        build_protocol_dataset_contract(dataset)


def test_names_follow_typescript_collation_and_object_filter_values_fail_closed() -> None:
    mixed = Dataset(
        name="a",
        source="orders",
        dimensions={
            "a1": dimension("string"),
            "A": dimension("string"),
            "a_": dimension("string"),
            "a": dimension("string"),
        },
    )
    snapshot = build_protocol_dataset_contract(mixed)
    dimensions = cast(list[dict[str, object]], snapshot["dimensions"])
    assert [entry["name"] for entry in dimensions] == ["a", "A", "a_", "a1"]

    object_filter = Dataset(
        name="objects",
        source="objects",
        dimensions={"id": dimension("string")},
        measures={"total": measure(sum("id"), filters=(eq("id", {"a": 1}),))},
    )
    with pytest.raises(ValueError, match="Object-valued measure filters"):
        build_protocol_dataset_contract(object_filter)


def test_bundle_bytes_and_identity_match_the_protocol_codecs() -> None:
    customers, orders = _model()
    registry = create_dataset_registry(orders, customers)
    first = prepare_dataset_bundle(registry, endpoints={"orders": _endpoint()})
    second = prepare_dataset_bundle(
        create_dataset_registry(customers, orders), endpoints={"orders": _endpoint()}
    )
    assert first == second

    contract = json.loads(first.deployment_bytes)
    prepared = prepare_protocol_deployment_contract(contract)
    assert first.deployment_bytes == prepared.contract_bytes + b"\n"
    assert first.deployment_identity == prepared.identity

    manifest = json.loads(first.manifest_bytes)
    assert manifest["artifacts"] == []
    assert manifest["deployment"] == {
        "path": "deployment.json",
        "identity": prepared.identity,
        "sha256": hashlib.sha256(first.deployment_bytes).hexdigest(),
        "byteLength": len(first.deployment_bytes),
    }
    assert first.bundle_identity == prepare_protocol_deployment_bundle_manifest(manifest).identity
    # These identities were produced independently by the TypeScript builders
    # over the same definitions and endpoint policy.
    assert (
        first.deployment_identity
        == "8ab9ce91eee17f38072a733a68f28def960697cfa1ca97551253e0306d6904e0"
    )
    assert (
        first.bundle_identity == "11134563ccaa1723e389d2b2072c4de2cb49f0ab89e565fa1923c6391955ecf2"
    )


def test_writer_creates_only_declared_files_and_refuses_existing_output(tmp_path: Path) -> None:
    customers, orders = _model()
    registry = create_dataset_registry(customers, orders)
    destination = tmp_path / "bundle"
    prepared = write_dataset_bundle(destination, registry, endpoints={"orders": _endpoint()})

    assert {entry.name for entry in destination.iterdir()} == {"deployment.json", "bundle.json"}
    assert (destination / "deployment.json").read_bytes() == prepared.deployment_bytes
    assert (destination / "bundle.json").read_bytes() == prepared.manifest_bytes
    with pytest.raises(FileExistsError):
        write_dataset_bundle(destination, registry, endpoints={"orders": _endpoint()})


def test_writer_does_not_replace_directory_created_during_publish(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    customers, orders = _model()
    registry = create_dataset_registry(customers, orders)
    destination = tmp_path / "bundle"
    mkdir = Path.mkdir

    def competing_mkdir(
        path: Path, mode: int = 0o777, parents: bool = False, exist_ok: bool = False
    ) -> None:
        if path == destination:
            mkdir(path)
        mkdir(path, mode=mode, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(Path, "mkdir", competing_mkdir)
    with pytest.raises(FileExistsError):
        write_dataset_bundle(destination, registry, endpoints={"orders": _endpoint()})
    assert destination.is_dir()
    assert list(destination.iterdir()) == []
