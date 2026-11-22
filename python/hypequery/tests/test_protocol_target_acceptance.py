"""RFC 0030 target-acceptance vectors, shared with TypeScript."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from hypequery.datasets import Dataset, create_dataset_registry, dimension, measure, segment
from hypequery.datasets.aggregations import sum as sum_
from hypequery.datasets.deployment import (
    build_protocol_deployment_contract,
    uses_contract_3_features,
)
from hypequery.datasets.query_helpers import eq
from hypequery.protocol import (
    PROTOCOL_CONTRACT_3_FEATURES,
    contract_3_features,
    validate_protocol_deployment_contract_any_version,
    validate_protocol_deployment_target_accepts,
)
from hypequery.protocol.errors import ProtocolDeploymentError

DRAFTS = Path(__file__).resolve().parents[3] / "specs/security-protocol/drafts/target-acceptance-v1"
ACCEPTS = json.loads((DRAFTS / "accepts.json").read_text())
FEATURES = json.loads((DRAFTS / "contract-3-features.json").read_text())


@pytest.mark.parametrize("case", ACCEPTS["accepted"], ids=lambda case: case["id"])
def test_accepts_parses(case: dict[str, object]) -> None:
    parsed = (
        validate_protocol_deployment_target_accepts(case["value"])
        if "value" in case
        else validate_protocol_deployment_target_accepts()
    )
    expected = case["expected"]
    assert isinstance(expected, dict)
    assert {key: list(value) for key, value in parsed.items()} == expected


@pytest.mark.parametrize("case", ACCEPTS["rejected"], ids=lambda case: case["id"])
def test_accepts_rejects(case: dict[str, object]) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_target_accepts(case["value"])
    assert (raised.value.code, raised.value.path) == (case["code"], case["path"])


@pytest.mark.parametrize("case", FEATURES, ids=lambda case: case["id"])
def test_contract_3_features(case: dict[str, object]) -> None:
    contract = validate_protocol_deployment_contract_any_version(case["contract"])
    datasets = contract["datasets"]
    assert isinstance(datasets, list)
    actual = [
        {"dataset": dataset["name"], "features": features}
        for dataset in datasets
        if (features := contract_3_features(dataset))
    ]
    assert actual == case["expected"]
    # The lowest-version rule: contract 3 exactly when a dataset forces it.
    assert contract["version"] == (3 if actual else 2)


def test_registry_order_matches_typescript() -> None:
    assert PROTOCOL_CONTRACT_3_FEATURES == (
        "segments",
        "windowMeasures",
        "shiftMeasures",
        "approxCountDistinct",
        "subDayDefaultGrain",
        "alternateTimeFields",
    )


def _orders(
    measures: dict[str, Any] | None = None, segments: dict[str, Any] | None = None
) -> Dataset:
    return Dataset(
        name="orders",
        source="analytics.orders",
        time_key="createdAt",
        dimensions={
            "amount": dimension("number"),
            "createdAt": dimension("timestamp"),
            "status": dimension("string"),
        },
        measures={"revenue": measure(sum_("amount")), **(measures or {})},
        segments=segments or {},
    )


@pytest.mark.parametrize(
    ("dataset", "expected"),
    [
        (_orders(), []),
        (_orders(segments={"paid": segment(eq("status", "paid"))}), ["segments"]),
        (_orders({"rolling": measure.trailing("revenue", 7, "day")}), ["windowMeasures"]),
        (_orders({"lastWeek": measure.shift("revenue", 1, "week")}), ["shiftMeasures"]),
        (_orders({"buyers": measure.approx_count_distinct("status")}), ["approxCountDistinct"]),
    ],
    ids=["none", "segments", "window", "shift", "approx"],
)
def test_authoring_rule_is_the_contract_rule(dataset: Dataset, expected: list[str]) -> None:
    contract = build_protocol_deployment_contract(create_dataset_registry(dataset))
    assert uses_contract_3_features(dataset) is bool(expected)
    assert contract["version"] == (3 if expected else 2)
    published = contract["datasets"]
    assert isinstance(published, list)
    assert contract_3_features(published[0]) == expected
