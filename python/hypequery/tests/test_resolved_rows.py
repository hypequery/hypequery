"""Resolved-row sources (RFC 0021): FINAL, the current-row filter and its settings pin."""

from __future__ import annotations

from typing import Never, cast

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    RowResolution,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    measure,
    resolved_rows,
    tenant,
)
from hypequery.datasets.cache.preimage_inputs import local_definition_identity
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.contract import serialize_semantic_contract
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.relationship_check_plan import plan_relationship_checks
from hypequery.protocol.errors import ProtocolIdentifierError
from hypequery.protocol.row_resolution import row_resolution

PIN = "SETTINGS optimize_move_to_prewhere_if_final = 0"


class _Executor:
    def execute(self, compiled: CompiledQuery) -> Never:
        raise AssertionError("planning only")


def users(policy: RowResolution | None) -> Dataset:
    return dataset(
        "users",
        source="app.users",
        tenant_key="tenant_id",
        dimensions={"id": dimension.string(), "plan": dimension.string()},
        measures={"users": measure.count("id")},
        row_resolution=policy,
    )


USERS = users(resolved_rows.replacing(deleted_column="is_deleted"))
EVENTS = dataset(
    "events",
    source="app.events",
    tenant_key="tenant_id",
    dimensions={"userId": dimension.string(column="user_id"), "kind": dimension.string()},
    measures={"events": measure.count("kind")},
    relationships={"user": belongs_to(USERS, from_field="user_id", to_field="id")},
)
REGISTRY = create_dataset_registry(USERS, EVENTS)
CLIENT = create_dataset_client(executor=_Executor(), registry=REGISTRY)
ACME = ExecutionContext(tenant=tenant("acme"))


def sql(target: Dataset, query: DatasetQuery) -> str:
    # Variants of `users` are planned alone, without the registry they would clash with.
    client = CLIENT if target in (USERS, EVENTS) else create_dataset_client(executor=_Executor())
    return client.to_sql(target, query, context=ACME)


@pytest.mark.parametrize(
    ("policy", "protocol"),
    [
        (resolved_rows.final(), {"kind": "final"}),
        (resolved_rows.replacing(), {"kind": "final", "engine": "replacing"}),
        (
            resolved_rows.replacing(deleted_column="is_deleted"),
            {"kind": "final", "engine": "replacing", "deletedColumn": "is_deleted"},
        ),
        (
            resolved_rows.collapsing(sign_column="sign"),
            {"kind": "final", "engine": "collapsing", "signColumn": "sign"},
        ),
        (
            resolved_rows.versioned_collapsing(sign_column="sign"),
            {"kind": "final", "engine": "versioned-collapsing", "signColumn": "sign"},
        ),
    ],
)
def test_policies_have_the_protocols_shape(policy: RowResolution, protocol: object) -> None:
    assert policy.to_protocol() == protocol
    # The protocol validator, shared with TypeScript, accepts it unchanged.
    assert row_resolution(policy.to_protocol(), "$") == protocol


@pytest.mark.parametrize(
    "data",
    [
        {"deleted_column": "is_deleted"},
        {"engine": "replacing", "sign_column": "sign"},
        {"engine": "collapsing"},
        {"engine": "collapsing", "sign_column": "sign", "deleted_column": "d"},
        {"engine": "replacing", "deleted_column": "bad name"},
        {"engine": "summing"},
    ],
)
def test_invalid_policies_are_refused(data: dict[str, object]) -> None:
    with pytest.raises((ValidationError, ProtocolIdentifierError)):
        RowResolution.model_validate(data)


def test_the_source_is_read_with_final_and_only_current_rows() -> None:
    statement = sql(USERS, DatasetQuery(dimensions=("plan",), measures=("users",)))
    assert "FROM `app`.`users` AS `__hq_base` FINAL WHERE `__hq_base`.`is_deleted` = 0 AND " in (
        statement
    )
    # The tenant filter applies to resolved rows, after the current-row filter.
    assert "`__hq_base`.`tenant_id` = " in statement
    assert statement.endswith(PIN)


def test_final_alone_and_collapsing_engines() -> None:
    plain = sql(users(resolved_rows.final()), DatasetQuery(measures=("users",)))
    assert "FINAL WHERE `__hq_base`.`tenant_id`" in plain
    collapsing = sql(
        users(resolved_rows.collapsing(sign_column="sign")), DatasetQuery(measures=("users",))
    )
    assert "FINAL WHERE `__hq_base`.`sign` = 1 AND " in collapsing


def test_a_plain_dataset_is_unchanged() -> None:
    statement = sql(users(None), DatasetQuery(measures=("users",)))
    assert "FINAL" not in statement
    assert "SETTINGS" not in statement


def test_a_joined_target_resolves_before_the_join() -> None:
    statement = sql(EVENTS, DatasetQuery(dimensions=("user.plan",), measures=("events",)))
    assert "FROM `app`.`users` FINAL WHERE `is_deleted` = 0)" in statement
    # The base source is not resolved, but the statement still pins the setting.
    assert "FROM `app`.`events` AS `__hq_base` LEFT ANY JOIN" in statement
    assert statement.endswith(PIN)
    # Without the join, nothing is pinned.
    assert "SETTINGS" not in sql(EVENTS, DatasetQuery(measures=("events",)))


def test_relationship_key_checks_count_current_rows() -> None:
    (check,) = plan_relationship_checks(EVENTS, REGISTRY, ACME, None)
    assert "FROM `app`.`users` FINAL WHERE `is_deleted` = 0 AND" in check.compiled.sql
    assert check.compiled.sql.endswith(PIN)


def test_catalog_contract_deployment_and_cache_identity_carry_the_policy() -> None:
    protocol = {"kind": "final", "engine": "replacing", "deletedColumn": "is_deleted"}
    assert get_dataset_catalog(USERS, registry=REGISTRY)["rowResolution"] == protocol
    contract = serialize_semantic_contract(REGISTRY)
    assert contract["datasets"]["users"]["rowResolution"] == protocol  # type: ignore[index]
    deployment = build_protocol_deployment_contract(REGISTRY)
    published = {d["name"]: d for d in cast(list[dict[str, object]], deployment["datasets"])}
    assert published["users"]["rowResolution"] == protocol
    assert "rowResolution" not in published["events"]
    assert local_definition_identity([USERS]) != local_definition_identity([users(None)])
