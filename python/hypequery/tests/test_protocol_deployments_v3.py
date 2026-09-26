"""RFC 0015 deployment contract 3 (``deployments-v3``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN,
    ProtocolDeploymentError,
    prepare_protocol_deployment_contract_v3,
    validate_protocol_deployment_contract,
    validate_protocol_deployment_contract_v3,
)

FIXTURES = Path(__file__).resolve().parents[3] / "specs" / "security-protocol" / "fixtures"


def _load(family: str, name: str) -> list[dict[str, object]]:
    path = FIXTURES / family / name
    return cast(list[dict[str, object]], json.loads(path.read_text(encoding="utf-8")))


SUCCESS = _load("deployments-v3", "success.json")
REJECTIONS = _load("deployments-v3", "rejections.json")
IDENTITIES = {str(case["id"]): case for case in _load("deployments-v3", "identity.json")}


@pytest.mark.parametrize("case", SUCCESS, ids=lambda case: str(case["id"]))
def test_success_cases_reproduce_their_identities(case: dict[str, object]) -> None:
    prepared = prepare_protocol_deployment_contract_v3(case["value"])
    expected = IDENTITIES[str(case["id"])]
    assert prepared.canonical == expected["canonical"]
    assert prepared.identity == expected["sha256"]


@pytest.mark.parametrize("case", REJECTIONS, ids=lambda case: str(case["id"]))
def test_rejections(case: dict[str, object]) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract_v3(case["value"])
    assert raised.value.code == case["error"]


def test_contract_2_is_unchanged() -> None:
    assert PROTOCOL_DEPLOYMENT_V3_IDENTITY_DOMAIN == "hypequery:deployment:v3\0"
    for case in _load("deployments-v2", "success.json"):
        validate_protocol_deployment_contract(case["value"])
        with pytest.raises(ProtocolDeploymentError) as raised:
            validate_protocol_deployment_contract_v3(case["value"])
        assert raised.value.code == "HQ_DEPLOYMENT_INVALID_VERSION"
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(
            {**cast(dict[str, object], SUCCESS[0]["value"]), "version": 2}
        )
    assert raised.value.code == "HQ_DEPLOYMENT_UNKNOWN_FIELD"


def test_time_measures_keep_authored_order() -> None:
    case = next(item for item in SUCCESS if item["id"] == "window-and-shift-measures")
    contract = validate_protocol_deployment_contract_v3(case["value"])
    dataset = cast(list[dict[str, object]], contract["datasets"])[0]
    measures = cast(list[dict[str, object]], dataset["measures"])
    assert [item.get("kind", "base") for item in measures] == [
        "base",
        "window",
        "window",
        "window",
        "shift",
        "derived",
    ]
    assert "filters" not in dataset
