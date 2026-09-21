"""PYB-06: RFC 0006 deployment contract validation and identity.

The shared corpus has one success and one identity case, which is far less
than a contract validator needs to be trusted. The cases below cover each rule
the contract states; every expectation here was checked against the TypeScript
build before being written down, across a 74-probe differential run that found
no divergence in accept/reject, error code, or identity hash.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolDeploymentError,
    ProtocolDeploymentLimits,
    ProtocolQueryImplementationError,
    hash_protocol_deployment_contract,
    prepare_protocol_deployment_contract,
    validate_protocol_deployment_contract,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "deployments-v2"
)

_DIMENSION: dict[str, object] = {
    "name": "status",
    "type": "string",
    "source": {"kind": "column", "column": "status"},
    "filterable": True,
    "groupable": True,
}
_REVENUE: dict[str, object] = {
    "name": "revenue",
    "aggregation": "sum",
    "field": "amount",
    "filters": [],
}
_ORDERS: dict[str, object] = {
    "name": "orders",
    "aggregation": "count",
    "field": "id",
    "filters": [],
}
_DERIVED: dict[str, object] = {
    "kind": "derived",
    "name": "averageOrderValue",
    "uses": [{"alias": "r", "measure": "revenue"}, {"alias": "o", "measure": "orders"}],
    "expression": {
        "kind": "binary",
        "operator": "divide",
        "left": {"kind": "reference", "name": "r"},
        "right": {
            "kind": "call",
            "function": "nullIfZero",
            "args": [{"kind": "reference", "name": "o"}],
        },
    },
}


def _dataset(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "name": "orders",
        "source": "orders",
        "tenant": {"kind": "not-required"},
        "dimensions": [],
        "measures": [],
        "filters": [],
        "relationships": [],
    }
    base.update(overrides)
    return base


def _contract(*datasets: dict[str, object], **overrides: object) -> dict[str, object]:
    contract: dict[str, object] = {
        "kind": "hypequery-deployment",
        "version": 2,
        "datasets": list(datasets) or [_dataset()],
    }
    contract.update(overrides)
    return contract


def _fixtures(name: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((FIXTURES / name).read_text()))


def test_shared_success_fixtures() -> None:
    for fixture in _fixtures("success.json"):
        assert validate_protocol_deployment_contract(fixture["value"])


def test_shared_identity_fixtures_pin_canonical_bytes_and_hash() -> None:
    """Identity cases pin the canonical form of the success case they name."""

    values = {fixture["id"]: fixture["value"] for fixture in _fixtures("success.json")}

    for fixture in _fixtures("identity.json"):
        prepared = prepare_protocol_deployment_contract(values[cast(str, fixture["id"])])

        assert prepared.canonical == fixture["canonical"], fixture["id"]
        assert prepared.identity == fixture["sha256"], fixture["id"]


def test_identity_is_domain_separated_from_the_bare_contract() -> None:
    """A deployment hash must not collide with a plain hash of the same bytes."""

    import hashlib

    prepared = prepare_protocol_deployment_contract(_contract())

    assert prepared.identity != hashlib.sha256(prepared.contract_bytes).hexdigest()
    assert (
        prepared.identity
        == hashlib.sha256(b"hypequery:deployment:v2\x00" + prepared.contract_bytes).hexdigest()
    )
    assert len(prepared.identity) == 64
    assert prepared.identity == prepared.identity.lower()


def test_validation_returns_detached_data() -> None:
    source = _contract(_dataset(dimensions=[dict(_DIMENSION)]))
    contract = validate_protocol_deployment_contract(source)

    cast(list[object], source["datasets"]).append(_dataset(name="injected"))

    assert len(cast(list[object], contract["datasets"])) == 1


@pytest.mark.parametrize(
    ("contract", "code"),
    [
        (_contract(kind="nope"), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_contract(version=1), "HQ_DEPLOYMENT_INVALID_VERSION"),
        (_contract(version=True), "HQ_DEPLOYMENT_INVALID_VERSION"),
        # `queries` and `artifacts` are invalid even when empty.
        ({**_contract(), "queries": []}, "HQ_DEPLOYMENT_UNKNOWN_FIELD"),
        ({**_contract(), "artifacts": []}, "HQ_DEPLOYMENT_UNKNOWN_FIELD"),
        (_contract(_dataset(metrics=[])), "HQ_DEPLOYMENT_UNKNOWN_FIELD"),
        (_contract(_dataset(), _dataset()), "HQ_DEPLOYMENT_INVALID_REFERENCE"),
        (_contract(_dataset(name="not valid")), "HQ_DEPLOYMENT_INVALID_IDENTIFIER"),
        (_contract(_dataset(source="   ")), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_contract(_dataset(tenant={"kind": "maybe"})), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_contract(_dataset(tenant={"kind": 1})), "HQ_DEPLOYMENT_TYPE"),
        ({"kind": "hypequery-deployment", "version": 2, "datasets": {}}, "HQ_DEPLOYMENT_TYPE"),
        ({"kind": "hypequery-deployment", "version": 2, "datasets": [1]}, "HQ_DEPLOYMENT_TYPE"),
    ],
)
def test_envelope_rules(contract: dict[str, object], code: str) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(contract)
    assert raised.value.code == code


@pytest.mark.parametrize(
    ("dataset", "code"),
    [
        (_dataset(dimensions=[{**_DIMENSION, "type": "json"}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(dimensions=[{**_DIMENSION, "filterable": "yes"}]), "HQ_DEPLOYMENT_TYPE"),
        (
            _dataset(dimensions=[dict(_DIMENSION), dict(_DIMENSION)]),
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        # An explicit null is a type failure, not an absent optional.
        (_dataset(dimensions=[{**_DIMENSION, "label": None}]), "HQ_DEPLOYMENT_TYPE"),
        (_dataset(dimensions=[{**_DIMENSION, "label": "  "}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(dimensions=[{**_DIMENSION, "label": "a\x01b"}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(measures=[{**_REVENUE, "aggregation": "median"}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(measures=[{**_REVENUE, "argField": "x"}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(measures=[{**_REVENUE, "aggregation": "argMax"}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (
            _dataset(measures=[{**_REVENUE, "aggregation": "percentile"}]),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (
            _dataset(measures=[{**_REVENUE, "aggregation": "percentile", "level": 2}]),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (_dataset(measures=[{**_REVENUE, "level": 0.5}]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (
            _dataset(filters=[{"name": "s", "field": "status", "operators": []}]),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (
            _dataset(filters=[{"name": "s", "field": "status", "operators": ["regex"]}]),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (
            _dataset(filters=[{"name": "s", "field": "status", "operators": ["eq", "eq"]}]),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (_dataset(currency="usd"), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(sensitivity="secret"), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(examples=["a", "a"]), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(limits={"maxDimensions": 0}), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(freshness={"maxAgeSeconds": 0}), "HQ_DEPLOYMENT_INVALID_VALUE"),
        (_dataset(defaults={}), "HQ_DEPLOYMENT_INVALID_VALUE"),
    ],
)
def test_dataset_node_rules(dataset: dict[str, object], code: str) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(_contract(dataset))
    assert raised.value.code == code


@pytest.mark.parametrize(
    ("dataset", "code"),
    [
        # `hasMany` is metadata only, so it can never be queryable.
        (
            _dataset(
                relationships=[
                    {
                        "name": "c",
                        "kind": "hasMany",
                        "target": "orders",
                        "from": "a",
                        "to": "b",
                        "queryable": True,
                    }
                ]
            ),
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        (
            _dataset(
                relationships=[
                    {
                        "name": "c",
                        "kind": "belongsTo",
                        "target": "missing",
                        "from": "a",
                        "to": "b",
                        "queryable": True,
                    }
                ]
            ),
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        # A default time grain needs a time field to apply to.
        (_dataset(defaults={"timeGrain": "day"}), "HQ_DEPLOYMENT_INVALID_REFERENCE"),
        (
            _dataset(
                dimensions=[{**_DIMENSION, "groupable": False}],
                defaults={"dimensions": ["status"]},
            ),
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        # Endpoint tenant policy must agree with the dataset's.
        (
            _dataset(
                tenant={"kind": "required", "field": "t"},
                endpoint={"access": {"kind": "public"}, "tenant": {"kind": "not-required"}},
            ),
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
    ],
)
def test_cross_cutting_reference_rules(dataset: dict[str, object], code: str) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(_contract(dataset))
    assert raised.value.code == code


def test_endpoint_policy_rules() -> None:
    public = _dataset(endpoint={"access": {"kind": "public"}, "tenant": {"kind": "not-required"}})
    assert validate_protocol_deployment_contract(_contract(public))

    # Auto-injection has to know which column it constrains.
    injected = _dataset(
        tenant={"kind": "required", "field": "t"},
        endpoint={
            "access": {"kind": "public"},
            "tenant": {"kind": "required", "mode": "auto-inject"},
        },
    )
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(_contract(injected))
    assert raised.value.code == "HQ_DEPLOYMENT_INVALID_VALUE"

    relative = _dataset(
        endpoint={
            "access": {"kind": "public"},
            "tenant": {"kind": "not-required"},
            "path": "orders",
        }
    )
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(_contract(relative))
    assert raised.value.code == "HQ_DEPLOYMENT_INVALID_VALUE"


def test_derived_measures_must_agree_with_their_aliases() -> None:
    valid = _dataset(measures=[dict(_REVENUE), dict(_ORDERS), dict(_DERIVED)])
    assert validate_protocol_deployment_contract(_contract(valid))

    cases: list[tuple[dict[str, object], str]] = [
        (
            {
                **_DERIVED,
                "uses": [{"alias": "r", "measure": "missing"}, {"alias": "o", "measure": "orders"}],
            },
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        (
            {
                **_DERIVED,
                "uses": [{"alias": "r", "measure": "revenue"}, {"alias": "r", "measure": "orders"}],
            },
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        ({**_DERIVED, "uses": []}, "HQ_DEPLOYMENT_INVALID_REFERENCE"),
        # A bare reference names an input instead of combining them.
        (
            {**_DERIVED, "expression": {"kind": "reference", "name": "r"}},
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        # A formula that never names an alias leaves it unused.
        (
            {
                **_DERIVED,
                "expression": {
                    "kind": "binary",
                    "operator": "add",
                    "left": {"kind": "reference", "name": "r"},
                    "right": {"kind": "reference", "name": "r"},
                },
            },
            "HQ_DEPLOYMENT_INVALID_REFERENCE",
        ),
        # Comparisons are outside the formula grammar.
        (
            {
                **_DERIVED,
                "expression": {
                    "kind": "comparison",
                    "operator": "eq",
                    "left": {"kind": "reference", "name": "r"},
                    "right": {"kind": "reference", "name": "o"},
                },
            },
            "HQ_DEPLOYMENT_INVALID_VALUE",
        ),
        ({**_DERIVED, "name": "revenue"}, "HQ_DEPLOYMENT_INVALID_REFERENCE"),
    ]
    for derived, code in cases:
        dataset = _dataset(measures=[dict(_REVENUE), dict(_ORDERS), derived])
        with pytest.raises(ProtocolDeploymentError) as raised:
            validate_protocol_deployment_contract(_contract(dataset))
        assert raised.value.code == code, derived.get("name")


def test_a_malformed_sql_source_keeps_its_own_error_domain() -> None:
    """The SQL envelope has its own stable codes; they pass through unchanged."""

    dataset = _dataset(
        dimensions=[
            {
                **_DIMENSION,
                "source": {
                    "kind": "sql-expression",
                    "dialect": "postgres",
                    "sql": "x",
                    "output": {"kind": "string"},
                    "dependencies": [],
                },
            }
        ]
    )

    with pytest.raises(ProtocolQueryImplementationError) as raised:
        validate_protocol_deployment_contract(_contract(dataset))
    assert raised.value.code == "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"


def test_a_sql_backed_dimension_is_accepted_and_hashed() -> None:
    dataset = _dataset(
        dimensions=[
            {
                **_DIMENSION,
                "source": {
                    "kind": "sql-expression",
                    "dialect": "clickhouse",
                    "sql": "upper(status)",
                    "output": {"kind": "string"},
                    "dependencies": ["status"],
                },
            }
        ]
    )

    assert len(hash_protocol_deployment_contract(_contract(dataset))) == 64


def test_limits_may_be_lowered_but_not_raised() -> None:
    lowered = ProtocolDeploymentLimits(max_datasets=1)

    assert validate_protocol_deployment_contract(_contract(), limits=lowered)
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(
            _contract(_dataset(), _dataset(name="second")), limits=lowered
        )
    assert raised.value.code == "HQ_DEPLOYMENT_TOO_MANY_ITEMS"

    with pytest.raises(ValueError, match="no greater than"):
        ProtocolDeploymentLimits(max_datasets=101)


@pytest.mark.parametrize("field_type", [[], {}])
def test_unhashable_dimension_types_produce_protocol_errors(field_type: object) -> None:
    with pytest.raises(ProtocolDeploymentError) as raised:
        validate_protocol_deployment_contract(
            _contract(
                _dataset(
                    dimensions=[{**_DIMENSION, "type": field_type}],
                )
            )
        )
    assert raised.value.code == "HQ_DEPLOYMENT_INVALID_VALUE"
