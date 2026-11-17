"""Python publishes deployment contract 3 exactly as TypeScript does (RFC 0015).

`specs/datasets/contract-3-authoring-v1.json` is generated from
`packages/datasets/src/contract-3-authoring.fixture.ts`; this module authors the
same `events` dataset with the Python API and must emit the same contract.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hypequery.datasets import (
    Dataset,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004 - the dataset API's helper namespace
    formula,
    measure,
    prepare_dataset_bundle,
    segment,
)
from hypequery.datasets.deployment import (
    build_protocol_dataset_contract,
    build_protocol_deployment_contract,
)
from hypequery.protocol import (
    PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN,
    prepare_protocol_deployment_contract,
    prepare_protocol_deployment_contract_any_version,
    prepare_protocol_deployment_contract_v3,
    validate_protocol_deployment_contract_any_version,
    validate_protocol_deployment_contract_v3,
)
from hypequery.protocol.wire_numbers import to_binary64_tree

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "specs/datasets/contract-3-authoring-v1.json"
COMMON_FIXTURE = ROOT / "specs/datasets/common-authoring-v1.json"


def events() -> Dataset:
    return dataset(
        "events",
        source="analytics.events",
        tenant_key="tenant_id",
        time_key="occurredAt",
        dimensions={
            "amount": dimension.number(),
            "occurredAt": dimension.timestamp(),
            "plan": dimension.string(),
            "status": dimension.string(),
            "userId": dimension.string(),
        },
        measures={
            "revenue": measure.sum("amount"),
            "visitors": measure.approx_count_distinct("userId", label="Visitors"),
            "revenue7d": measure.trailing("revenue", 7, "day"),
            "revenueMtd": measure.to_date("revenue", "month"),
            "revenueRunning": measure.cumulative("revenue"),
            "visitors7d": measure.trailing("visitors", 7, "day"),
            "revenuePriorWeek": measure.shift("revenue", 1, "week"),
            "revenueGrowth": measure.derived(
                formula.divide(
                    formula.subtract("revenue", "revenuePriorWeek"),
                    formula.null_if_zero("revenuePriorWeek"),
                )
            ),
            "revenuePerVisitor": measure.derived(
                formula.divide("revenue", formula.null_if_zero("visitors"))
            ),
        },
        segments={
            "enterprise": segment(filter.eq("plan", "enterprise"), description="Enterprise plan"),
            "bigPaid": segment(filter.eq("status", "paid"), filter.gte("amount", 100)),
        },
    )


def test_python_emits_the_shared_contract_3_fixture() -> None:
    expected = json.loads(FIXTURE.read_text())
    actual = build_protocol_deployment_contract(create_dataset_registry(events()))
    assert actual == expected


def test_contract_3_bundle_uses_the_v3_identity_domain() -> None:
    registry = create_dataset_registry(events())
    bundle = prepare_dataset_bundle(registry)
    # Wire numbers are binary64, as a TypeScript reader parses them.
    deployment = to_binary64_tree(json.loads(bundle.deployment_bytes))
    assert isinstance(deployment, dict)
    assert deployment["version"] == 3
    validate_protocol_deployment_contract_v3(deployment)
    assert validate_protocol_deployment_contract_any_version(deployment)["version"] == 3
    prepared = prepare_protocol_deployment_contract_v3(build_protocol_deployment_contract(registry))
    assert bundle.deployment_bytes == prepared.contract_bytes + b"\n"
    assert bundle.deployment_identity == prepared.identity
    assert PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN == "hypequery:deployment:v3\0"
    manifest = json.loads(bundle.manifest_bytes)
    assert manifest["deployment"]["identity"] == prepared.identity


def test_a_deployment_without_contract_3_features_stays_contract_2() -> None:
    expected = to_binary64_tree(json.loads(COMMON_FIXTURE.read_text()))
    prepared = prepare_protocol_deployment_contract_any_version(expected)
    assert prepared.contract["version"] == 2
    # Contract 2 keeps the identity it had before contract 3 existed.
    assert prepared.identity == prepare_protocol_deployment_contract(expected).identity
    assert validate_protocol_deployment_contract_any_version(expected) == expected


def test_contract_3_features_are_refused_by_the_standalone_contract_2_snapshot() -> None:
    with pytest.raises(ValueError, match=r"shift measures \(revenuePriorWeek\)"):
        build_protocol_dataset_contract(events())
