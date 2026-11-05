"""Null-check filters (RFC 0023): `churned_at IS NOT NULL`, not a sentinel range."""

from __future__ import annotations

from typing import Any, Never

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    SEMANTIC_FILTER_OPERATORS,
    SEMANTIC_NULL_CHECK_OPERATORS,
    CompiledQuery,
    DatasetQuery,
    FilterDefinition,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
)
from hypequery.datasets.cache.preimage_inputs import wire_query
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.deployment import build_protocol_deployment_contract
from hypequery.datasets.planner import CompiledQueryError
from hypequery.datasets.query_helpers import Filter
from hypequery.protocol import validate_protocol_expression


class _Executor:
    def execute(self, compiled: CompiledQuery) -> Never:
        raise AssertionError("planning only")


CUSTOMERS = dataset(
    "customers",
    source="customers",
    time_key="signed_up_at",
    dimensions={
        "plan": dimension.string(),
        "trial": dimension.boolean(),
        "seats": dimension.number(),
        "signedUpAt": dimension.timestamp(column="signed_up_at"),
        "churnedAt": dimension.timestamp(column="churned_at"),
    },
    measures={
        "customers": measure.count("plan"),
        "churnedCustomers": measure.count("plan", filters=(filter.is_not_null("churnedAt"),)),
        "activeCustomers": measure.count("plan", filters=(filter.is_null("churnedAt"),)),
    },
    filters={
        "plan": FilterDefinition(field="plan"),
        "trial": FilterDefinition(field="trial", operators=("eq", "isNull", "isNotNull")),
        "churnedAt": FilterDefinition(field="churnedAt", operators=("gte", "isNull", "isNotNull")),
    },
)
CLIENT = create_dataset_client(executor=_Executor())


def sql(query: DatasetQuery) -> str:
    return CLIENT.to_sql(CUSTOMERS, query)


def test_the_helpers_build_value_free_comparisons() -> None:
    assert filter.is_null("plan").operator == "isNull"
    assert filter.is_not_null("plan").operator == "isNotNull"
    assert filter.is_null("plan").model_dump() == {"field": "plan", "operator": "isNull"}
    assert SEMANTIC_NULL_CHECK_OPERATORS == ("isNull", "isNotNull")
    # The default list is unchanged, so existing deployments keep their identity.
    assert "isNull" not in SEMANTIC_FILTER_OPERATORS


@pytest.mark.parametrize(
    "data",
    [
        {"field": "plan", "operator": "isNull", "value": None},
        {"field": "plan", "operator": "isNotNull", "value": "x"},
        {"field": "plan", "operator": "eq"},
    ],
)
def test_a_null_check_takes_no_value_and_others_need_one(data: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Filter.model_validate(data)


def test_measure_fixed_filters_render_is_null_and_is_not_null() -> None:
    statement = sql(DatasetQuery(measures=("churnedCustomers", "activeCustomers")))
    assert "`churned_at` IS NOT NULL" in statement
    assert "`churned_at` IS NULL" in statement
    assert "1971" not in statement


def test_an_opted_in_query_filter_binds_nothing_and_skips_timezone_conversion() -> None:
    statement = sql(
        DatasetQuery(
            measures=("customers",),
            filters=(
                filter.is_not_null("churnedAt"),
                filter.gte("churnedAt", "2026-01-01"),
                filter.is_null("trial"),
            ),
            timezone="Europe/Berlin",
        )
    )
    assert "`__hq_base`.`churned_at` IS NOT NULL" in statement
    assert "`__hq_base`.`trial` IS NULL" in statement
    # Only the gte bound is a parameter.
    assert statement.count("<p") == 1


def test_null_checks_are_opt_in_for_caller_filters() -> None:
    # `plan` declares no operators: the default list, which has no null checks.
    with pytest.raises(CompiledQueryError, match="does not allow isNull"):
        sql(DatasetQuery(measures=("customers",), filters=(filter.is_null("plan"),)))
    # `seats` is a plain filterable dimension: also the default list.
    with pytest.raises(CompiledQueryError, match="does not allow isNotNull"):
        sql(DatasetQuery(measures=("customers",), filters=(filter.is_not_null("seats"),)))


def test_the_cache_and_deployment_wire_omit_the_right_hand_side() -> None:
    query = DatasetQuery(measures=("customers",), filters=(filter.is_null("trial"),))
    node = wire_query(CUSTOMERS, query)["filters"]
    assert node == [
        {"kind": "comparison", "operator": "isNull", "left": {"kind": "reference", "name": "trial"}}
    ]
    validate_protocol_expression(node[0])
    contract = build_protocol_deployment_contract(create_dataset_registry(CUSTOMERS))
    published = contract["datasets"][0]  # type: ignore[index]
    churned = next(m for m in published["measures"] if m["name"] == "churnedCustomers")
    assert "right" not in churned["filters"][0]
    filters = {f["name"]: f["operators"] for f in published["filters"]}
    assert filters["churnedAt"] == ["gte", "isNull", "isNotNull"]
    assert "isNull" not in filters["plan"]


def test_the_catalog_publishes_null_checks_only_where_declared() -> None:
    catalog = get_dataset_catalog(CUSTOMERS, registry=create_dataset_registry(CUSTOMERS))
    filters = {name: entry["operators"] for name, entry in catalog["filters"].items()}
    assert filters["trial"] == ["eq", "isNull", "isNotNull"]
    assert filters["plan"] == list(SEMANTIC_FILTER_OPERATORS)


def test_served_requests_accept_value_free_null_checks_only() -> None:
    import asyncio
    import json
    import re
    from dataclasses import dataclass

    from hypequery.serve import (
        Credential,
        HttpSecurity,
        Principal,
        add_dataset_endpoint,
        create_api,
    )
    from hypequery.serve.core.messages import Headers, ServeRequest

    @dataclass(frozen=True)
    class Rows:
        columns: tuple[str, ...]
        rows: tuple[tuple[object, ...], ...]

    seen: list[CompiledQuery] = []

    class Executor:
        def execute(self, compiled: CompiledQuery) -> Any:
            seen.append(compiled)
            columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql.split(" FROM ", 1)[0]))
            return Rows(columns, ((3,),))

    def auth(credential: Credential) -> Principal | None:
        return Principal(subject="a") if credential.value == "k" else None

    api = create_api(auth=auth, security=HttpSecurity(allowed_hosts=("localhost",)))
    add_dataset_endpoint(
        api, "/customers", dataset=CUSTOMERS, client=create_dataset_client(executor=Executor())
    )

    def post(body: dict[str, object]) -> int:
        payload = json.dumps(body).encode()
        request = ServeRequest(
            method="POST",
            path="/customers",
            headers=Headers(
                [
                    ("host", "localhost"),
                    ("authorization", "Bearer k"),
                    ("content-type", "application/json"),
                    ("content-length", str(len(payload))),
                ]
            ),
            body=payload,
        )
        return asyncio.run(api.handle(request)).status

    ok = {"measures": ["customers"], "filters": [{"field": "trial", "operator": "isNull"}]}
    assert post(ok) == 200
    assert "IS NULL" in seen[-1].sql
    carrying = {"field": "trial", "operator": "isNull", "value": None}
    assert post({"measures": ["customers"], "filters": [carrying]}) == 400
