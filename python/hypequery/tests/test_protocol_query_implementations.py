"""RFC 0005 closed query implementation union.

Python does not author named queries, but it reads deployments that contain
them, so what matters here is that it judges an implementation exactly as the
reference implementation does: the same three kinds, the same tenant rules, and
the same refusal of anything outside them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hypequery.protocol import (
    ProtocolCompiledSqlImplementation,
    ProtocolQueryImplementationError,
    ProtocolRuntimeReferenceImplementation,
    ProtocolSemanticPlanImplementation,
    ProtocolSqlInputSource,
    ProtocolSqlNotRequiredTenant,
    ProtocolSqlRequiredTenant,
    ProtocolSqlTenantSource,
    query_implementation_to_data,
    validate_protocol_query_implementation,
    validate_protocol_sql_expression,
)
from hypequery.protocol.query_implementation_fixtures import (
    materialize_implementation_fixture,
)

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "security-protocol"
    / "fixtures"
    / "query-implementations-v1"
)

DIGEST = "0123456789abcdef" * 4


def _compiled(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "kind": "compiled-sql",
        "dialect": "clickhouse",
        "operation": "select",
        "statement": "SELECT count() AS trips FROM trips",
        "parameters": [],
        "readSources": ["analytics.trips"],
        "tenant": {"kind": "not-required"},
    }
    base.update(overrides)
    return base


def _parameter(
    name: str = "since", source: object = None, click_house_type: str = "Date"
) -> dict[str, object]:
    return {
        "name": name,
        "source": source if source is not None else {"kind": "input", "path": "range.from"},
        "clickHouseType": click_house_type,
    }


def _runtime(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "kind": "runtime-reference",
        "runtime": "python",
        "artifactSha256": DIGEST,
        "entrypoint": "queries.customer_revenue",
    }
    base.update(overrides)
    return base


def _code(value: object) -> str:
    with pytest.raises(ProtocolQueryImplementationError) as caught:
        validate_protocol_query_implementation(value)
    return caught.value.code


def _case_value(case: dict[str, object]) -> object:
    generator = case.get("generator")
    if isinstance(generator, dict):
        return materialize_implementation_fixture(generator)
    return case.get("value")


def _cases(name: str) -> list[dict[str, object]]:
    return list(json.loads((FIXTURES / name).read_text()))


@pytest.mark.parametrize("case", _cases("success.json"), ids=lambda case: str(case["id"]))
def test_shared_success_fixtures_validate(case: dict[str, object]) -> None:
    validate = (
        validate_protocol_sql_expression
        if case["surface"] == "sql-expression"
        else validate_protocol_query_implementation
    )
    validate(_case_value(case))


@pytest.mark.parametrize("case", _cases("rejections.json"), ids=lambda case: str(case["id"]))
def test_shared_rejection_fixtures_report_their_code(case: dict[str, object]) -> None:
    validate = (
        validate_protocol_sql_expression
        if case["surface"] == "sql-expression"
        else validate_protocol_query_implementation
    )
    with pytest.raises(ProtocolQueryImplementationError) as caught:
        validate(_case_value(case))
    assert caught.value.code == case["error"]


def test_semantic_plan_carries_its_validated_query() -> None:
    implementation = validate_protocol_query_implementation(
        {
            "kind": "semantic-plan",
            "query": {"kind": "dataset", "dataset": "trips", "measures": ["count"]},
        }
    )
    assert isinstance(implementation, ProtocolSemanticPlanImplementation)
    assert implementation.query.dataset == "trips"


def test_semantic_plan_reports_an_invalid_query_in_its_own_domain() -> None:
    # The embedded query keeps expression validation but not expression error
    # codes: a caller of this surface handles one error type.
    assert _code({"kind": "semantic-plan", "query": {"kind": "nope"}}) == (
        "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"
    )


def test_semantic_plan_accepts_a_wire_integer_spelled_as_a_float() -> None:
    # `JSON.stringify` never emits `100.0`, but a Python producer can, and the
    # reference implementation reads both as the same number.
    implementation = validate_protocol_query_implementation(
        {
            "kind": "semantic-plan",
            "query": {"kind": "dataset", "dataset": "trips", "measures": ["c"], "limit": 100.0},
        }
    )
    assert isinstance(implementation, ProtocolSemanticPlanImplementation)
    assert implementation.query.limit == 100


def test_compiled_sql_keeps_parameters_in_order() -> None:
    implementation = validate_protocol_query_implementation(
        _compiled(parameters=[_parameter(), _parameter("until")])
    )
    assert isinstance(implementation, ProtocolCompiledSqlImplementation)
    assert [parameter.name for parameter in implementation.parameters] == ["since", "until"]
    assert isinstance(implementation.parameters[0].source, ProtocolSqlInputSource)
    assert implementation.parameters[0].source.path == "range.from"
    assert isinstance(implementation.tenant, ProtocolSqlNotRequiredTenant)


def test_compiled_sql_statement_keeps_formatting_whitespace() -> None:
    statement = "SELECT 1\n  FROM trips\n\tWHERE a = 1"
    implementation = validate_protocol_query_implementation(_compiled(statement=statement))
    assert isinstance(implementation, ProtocolCompiledSqlImplementation)
    assert implementation.statement == statement


def test_compiled_sql_rejects_a_control_character_in_a_clickhouse_type() -> None:
    # A statement may be formatted; a type name has no reason to be.
    assert _code(_compiled(parameters=[_parameter(click_house_type="Da\tte")])) == (
        "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"
    )


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"operation": "insert"}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"dialect": "postgres"}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"statement": "   "}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"readSources": ["trips", "trips"]}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"parameters": [_parameter(), _parameter()]}, "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE"),
        ({"parameters": [_parameter(name="1bad")]}, "HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER"),
        ({"parameters": "not-a-list"}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
    ],
)
def test_compiled_sql_rejections(overrides: dict[str, object], code: str) -> None:
    assert _code(_compiled(**overrides)) == code


def test_tenant_required_names_its_one_tenant_parameter() -> None:
    implementation = validate_protocol_query_implementation(
        _compiled(
            parameters=[_parameter("tenantId", {"kind": "tenant"}, "UUID")],
            tenant={"kind": "required", "parameter": "tenantId"},
        )
    )
    assert isinstance(implementation, ProtocolCompiledSqlImplementation)
    assert isinstance(implementation.tenant, ProtocolSqlRequiredTenant)
    assert implementation.tenant.parameter == "tenantId"
    assert isinstance(implementation.parameters[0].source, ProtocolSqlTenantSource)


def test_tenant_not_required_refuses_a_tenant_sourced_parameter() -> None:
    # Otherwise a statement would be scoped by trusted context while declaring
    # that it needs none, and only one of the two can be true.
    assert (
        _code(_compiled(parameters=[_parameter("tenantId", {"kind": "tenant"}, "UUID")]))
        == "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE"
    )


def test_tenant_required_refuses_a_second_tenant_parameter() -> None:
    assert (
        _code(
            _compiled(
                parameters=[
                    _parameter("tenantId", {"kind": "tenant"}, "UUID"),
                    _parameter("otherTenant", {"kind": "tenant"}, "UUID"),
                ],
                tenant={"kind": "required", "parameter": "tenantId"},
            )
        )
        == "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE"
    )


def test_tenant_required_refuses_an_input_sourced_parameter() -> None:
    # The whole point of the policy: a tenant a caller can supply is not a tenant.
    assert (
        _code(
            _compiled(
                parameters=[_parameter("tenantId")],
                tenant={"kind": "required", "parameter": "tenantId"},
            )
        )
        == "HQ_QUERY_IMPLEMENTATION_INVALID_REFERENCE"
    )


def test_runtime_reference_round_trips() -> None:
    implementation = validate_protocol_query_implementation(_runtime())
    assert isinstance(implementation, ProtocolRuntimeReferenceImplementation)
    assert query_implementation_to_data(implementation) == _runtime()


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"runtime": "deno"}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"artifactSha256": DIGEST.upper()}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"artifactSha256": DIGEST[:-1]}, "HQ_QUERY_IMPLEMENTATION_INVALID_VALUE"),
        ({"entrypoint": "queries/run"}, "HQ_QUERY_IMPLEMENTATION_INVALID_IDENTIFIER"),
        ({"path": "./queries.py"}, "HQ_QUERY_IMPLEMENTATION_UNKNOWN_FIELD"),
    ],
)
def test_runtime_reference_rejections(overrides: dict[str, object], code: str) -> None:
    assert _code(_runtime(**overrides)) == code


@pytest.mark.parametrize(
    ("value", "code"),
    [
        (None, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ([], "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({"kind": 1}, "HQ_QUERY_IMPLEMENTATION_TYPE"),
        ({"kind": "raw-sql"}, "HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND"),
        ({"kind": "sql-expression"}, "HQ_QUERY_IMPLEMENTATION_UNKNOWN_KIND"),
    ],
)
def test_union_is_closed(value: object, code: str) -> None:
    assert _code(value) == code


def test_compiled_sql_round_trips_through_data() -> None:
    value = _compiled(
        parameters=[
            _parameter(),
            _parameter("tenantId", {"kind": "tenant"}, "UUID"),
        ],
        tenant={"kind": "required", "parameter": "tenantId"},
    )
    assert query_implementation_to_data(validate_protocol_query_implementation(value)) == value
