"""Keep Python authoring/execution honest against the shared UI capability matrix."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    Dataset,
    add,
    create_dataset_registry,
    dimension,
    eq,
    measure,
)
from hypequery.datasets import sum as sum_
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.measures import Measure
from hypequery.datasets.planner import DatasetQuery, ExecutionContext, plan_dataset_query, tenant
from hypequery.protocol import (
    validate_protocol_deployment_contract_v3,
    validate_protocol_semantic_query,
)
from hypequery.protocol.errors import ProtocolExpressionError

ROOT = Path(__file__).resolve().parents[3]
MATRIX = json.loads((ROOT / "packages/datasets/src/execution-capabilities.json").read_text())


def orders() -> Dataset:
    return Dataset(
        name="orders",
        source="analytics.orders",
        tenant_key="tenant_id",
        time_key="createdAt",
        dimensions={
            "amount": dimension("number"),
            "createdAt": dimension("timestamp"),
            "status": dimension("string"),
        },
        measures={
            "revenue": measure(sum_("amount")),
            "paidRevenue": measure(sum_("amount"), filters=(eq("status", "paid"),)),
        },
    )


def test_shared_deployment_authoring_fixture() -> None:
    expected = json.loads((ROOT / "specs/datasets/common-authoring-v1.json").read_text())
    actual = build_protocol_deployment_contract(create_dataset_registry(orders()))
    assert actual == expected
    assert actual["version"] == MATRIX["cloudDeploymentVersion"]


@pytest.mark.parametrize("entry", MATRIX["features"], ids=lambda entry: entry["feature"])
def test_python_feature_support(entry: dict[str, object]) -> None:
    feature = entry["feature"]
    support = entry["python"]
    assert isinstance(support, dict)
    if feature in ("baseMeasures", "subDayGrains"):
        query = DatasetQuery(by="hour" if feature == "subDayGrains" else None)
        compiled = plan_dataset_query(
            orders(), query, context=ExecutionContext(tenant=tenant("acme"))
        )
        assert "SUM" in compiled.sql.upper()
        assert support["local"] is True
        if feature == "subDayGrains":
            assert "toStartOfHour" in compiled.sql
            # A time-enabled definition can be published, but invocation v1
            # cannot request its local sub-day grain.
            operation = {"kind": "dataset", "dataset": "orders", "by": "hour"}
            with pytest.raises(ProtocolExpressionError):
                validate_protocol_semantic_query(operation)
            validate_protocol_semantic_query(operation, extension=2)
            assert support["publish"] is False
        else:
            build_protocol_deployment_contract(create_dataset_registry(orders()))
            assert support["publish"] is True
        return

    if feature == "derivedMeasures":
        ds = orders()
        derived_dataset = Dataset(
            name=ds.name,
            source=ds.source,
            tenant_key=ds.tenant_key,
            dimensions=ds.dimensions,
            measures={**ds.measures, "doubleRevenue": measure.derived(add("revenue", "revenue"))},
        )
        compiled = plan_dataset_query(
            derived_dataset,
            DatasetQuery(measures=("doubleRevenue",)),
            context=ExecutionContext(tenant=tenant("acme")),
        )
        assert "sum(`amount`) + sum(`amount`)" in compiled.sql
        build_protocol_deployment_contract(create_dataset_registry(derived_dataset))
        assert support == {"local": True, "publish": True}
        return
    assert support == {"local": False, "publish": False}
    if feature == "segments":
        definition = orders().model_dump()
        definition["segments"] = {"paid": {"filters": [eq("status", "paid")]}}
        with pytest.raises(ValidationError):
            Dataset.model_validate(definition)
    elif feature == "approxCountDistinct":
        with pytest.raises(ValidationError):
            Measure.model_validate({"aggregation": "approxCountDistinct", "field": "amount"})
    else:
        kinds = {"derivedMeasures": "derived", "windowMeasures": "window", "shiftMeasures": "shift"}
        assert feature in kinds  # New matrix features need an executable probe.
        with pytest.raises(ValidationError):
            Measure.model_validate({"kind": kinds[feature], "measure": "revenue"})


def test_protocol_v3_acceptance_does_not_imply_python_authoring_support() -> None:
    fixtures = json.loads(
        (ROOT / "specs/security-protocol/fixtures/deployments-v3/success.json").read_text()
    )
    for fixture in fixtures:
        validate_protocol_deployment_contract_v3(fixture["value"])
