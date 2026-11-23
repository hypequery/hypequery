"""Keep Python authoring/execution honest against the shared UI capability matrix."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hypequery.datasets import (
    Dataset,
    create_dataset_registry,
    dimension,
    measure,
    segment,
)
from hypequery.datasets.aggregations import (
    sum as sum_,
)
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.formulas import (
    add,
)
from hypequery.datasets.planner import DatasetQuery, ExecutionContext, plan_dataset_query, tenant
from hypequery.datasets.query_helpers import (
    between,
    eq,
)
from hypequery.datasets.time_measures import ShiftMeasure, WindowMeasure
from hypequery.protocol import (
    validate_protocol_deployment_contract_v3,
    validate_protocol_deployment_target_accepts,
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
    # The lowest-version rule keeps this contract 2, which a target that
    # advertises nothing accepts (RFC 0030). The matrix makes no Cloud claim.
    assert actual["version"] == 2
    assert actual["version"] in validate_protocol_deployment_target_accepts()["deploymentContract"]
    assert "cloudDeploymentVersion" not in MATRIX
    assert all("cloud" not in entry for entry in MATRIX["features"])


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
        assert support == {"local": True, "publish": True}
        contract = build_protocol_deployment_contract(create_dataset_registry(orders()))
        # A time-enabled dataset with no grain restriction publishes as
        # contract 2 and accepts every grain once published.
        assert contract["version"] == 2
        if feature == "subDayGrains":
            assert "toStartOfHour" in compiled.sql
            # Invocation 1 cannot request a sub-day grain; extension 2 can.
            operation = {"kind": "dataset", "dataset": "orders", "by": "hour"}
            with pytest.raises(ProtocolExpressionError):
                validate_protocol_semantic_query(operation)
            validate_protocol_semantic_query(operation, extension=2)
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
        assert "sum(`__hq_base`.`amount`) + sum(`__hq_base`.`amount`)" in compiled.sql
        contract = build_protocol_deployment_contract(create_dataset_registry(derived_dataset))
        assert contract["version"] == 2
        assert support == {"local": True, "publish": True}
        return
    if feature == "approxCountDistinct":
        ds = orders()
        approximate = Dataset(
            name=ds.name,
            source=ds.source,
            tenant_key=ds.tenant_key,
            dimensions=ds.dimensions,
            measures={**ds.measures, "buyers": measure.approx_count_distinct("status")},
        )
        compiled = plan_dataset_query(
            approximate,
            DatasetQuery(measures=("buyers",)),
            context=ExecutionContext(tenant=tenant("acme")),
        )
        assert "uniq(`__hq_base`.`status`)" in compiled.sql
        # Approximate aggregations publish as deployment contract 3 (RFC 0015).
        contract = build_protocol_deployment_contract(create_dataset_registry(approximate))
        assert contract["version"] == 3
        assert support == {"local": True, "publish": True}
        return
    if feature == "segments":
        ds = orders()
        segmented = Dataset(
            name=ds.name,
            source=ds.source,
            tenant_key=ds.tenant_key,
            dimensions=ds.dimensions,
            measures=ds.measures,
            segments={"paid": segment(eq("status", "paid"))},
        )
        compiled = plan_dataset_query(
            segmented,
            DatasetQuery(segments=("paid",)),
            context=ExecutionContext(tenant=tenant("acme")),
        )
        assert "`__hq_base`.`status` = " in compiled.sql
        # Segments publish as deployment contract 3 (RFC 0015).
        contract = build_protocol_deployment_contract(create_dataset_registry(segmented))
        assert contract["version"] == 3
        assert support == {"local": True, "publish": True}
        return
    probes: dict[str, tuple[str, WindowMeasure | ShiftMeasure]] = {
        "windowMeasures": ("rolling", measure.trailing("revenue", 7, "day")),
        "shiftMeasures": ("lastWeek", measure.shift("revenue", 1, "week")),
    }
    assert feature in probes  # New matrix features need an executable probe.
    name, definition = probes[feature]
    ds = orders()
    timed = Dataset(
        name=ds.name,
        source=ds.source,
        tenant_key=ds.tenant_key,
        time_key=ds.time_key,
        dimensions=ds.dimensions,
        measures={**ds.measures, name: definition},
    )
    compiled = plan_dataset_query(
        timed,
        DatasetQuery(
            measures=(name,),
            by="day",
            filters=(between("createdAt", "2026-01-01", "2026-01-31"),),
        ),
        context=ExecutionContext(tenant=tenant("acme")),
    )
    assert compiled.sql.startswith("WITH ")
    # Window and shift measures publish as deployment contract 3 (RFC 0015).
    contract = build_protocol_deployment_contract(create_dataset_registry(timed))
    assert contract["version"] == 3
    assert support == {"local": True, "publish": True}


def test_protocol_v3_acceptance_does_not_imply_python_authoring_support() -> None:
    fixtures = json.loads(
        (ROOT / "specs/security-protocol/fixtures/deployments-v3/success.json").read_text()
    )
    for fixture in fixtures:
        validate_protocol_deployment_contract_v3(fixture["value"])
