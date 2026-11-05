"""Dataset segments (RFC 0015): named, author-defined row filters selected by name."""

from __future__ import annotations

from typing import Never

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetQuery,
    ExecutionContext,
    Segment,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
    segment,
    tenant,
)
from hypequery.datasets.cache.preimage_inputs import local_definition_identity, wire_query
from hypequery.datasets.catalog import get_dataset_catalog
from hypequery.datasets.planner import CompiledQueryError


class _Executor:
    def execute(self, compiled: CompiledQuery) -> Never:
        raise AssertionError("planning only")


CUSTOMERS = dataset(
    "customers",
    source="customers",
    dimensions={"id": dimension.string(), "tier": dimension.string()},
    measures={"customers": measure.count("id")},
)


def orders(**segments: Segment) -> Dataset:
    return dataset(
        "orders",
        source="orders",
        tenant_key="tenant_id",
        dimensions={
            "status": dimension.string(),
            # Not exposed to callers, but an author's segment may still use it.
            "channel": dimension.string(filterable=False),
            "refundedAt": dimension.timestamp(column="refunded_at"),
            "customerId": dimension.string(column="customer_id"),
            "tenantId": dimension.string(column="tenant_id"),
        },
        measures={"orders": measure.count("status")},
        relationships={"customer": belongs_to(CUSTOMERS, from_field="customer_id", to_field="id")},
        segments=segments
        or {
            "paid": segment(filter.eq("status", "paid"), label="Paid orders"),
            "online": segment(filter.eq("channel", "web"), filter.is_null("refundedAt")),
        },
    )


ORDERS = orders()
REGISTRY = create_dataset_registry(ORDERS, CUSTOMERS)
CLIENT = create_dataset_client(executor=_Executor(), registry=REGISTRY)
ACME = ExecutionContext(tenant=tenant("acme"))


def sql(query: DatasetQuery) -> str:
    return CLIENT.to_sql(ORDERS, query, context=ACME)


def test_selected_segments_become_predicates_beside_the_tenant() -> None:
    statement = sql(DatasetQuery(measures=("orders",), segments=("paid", "online")))
    assert "`__hq_base`.`status` = <p0:String>" in statement
    assert "`__hq_base`.`channel` = <p1:String>" in statement
    assert "`__hq_base`.`refunded_at` IS NULL" in statement
    assert "`__hq_base`.`tenant_id` = <p2:String>" in statement


def test_a_segment_is_applied_once_and_ands_with_caller_filters() -> None:
    statement = sql(
        DatasetQuery(
            measures=("orders",),
            filters=(filter.eq("status", "open"),),
            segments=("paid", "paid"),
        )
    )
    assert statement.count("`__hq_base`.`status` = ") == 2
    assert "<p2:String>" in statement  # caller filter, one segment, tenant
    assert "<p3:" not in statement


def test_an_unknown_segment_is_refused_by_name() -> None:
    with pytest.raises(CompiledQueryError, match=r'Unknown segment "vip".*Available: online, paid'):
        sql(DatasetQuery(measures=("orders",), segments=("vip",)))


@pytest.mark.parametrize(
    ("segments", "message"),
    [
        ({"related": segment(filter.eq("customer.tier", "gold"))}, "segments cannot use"),
        ({"tenant": segment(filter.eq("tenantId", "other"))}, "tenant column"),
        ({"typed": segment(filter.eq("refundedAt", "not a date"))}, "ISO 8601"),
    ],
)
def test_invalid_segments_are_refused_at_definition(
    segments: dict[str, Segment], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        orders(**segments)


def test_a_segment_needs_a_filter() -> None:
    with pytest.raises(ValidationError):
        Segment(filters=())


def test_the_catalog_lists_labels_never_filters() -> None:
    catalog = get_dataset_catalog(ORDERS, registry=REGISTRY)
    assert catalog["segments"] == {"paid": {"label": "Paid orders"}, "online": {}}


def test_cache_identity_follows_names_and_definitions() -> None:
    query = DatasetQuery(measures=("orders",), segments=("paid", "online", "paid"))
    assert wire_query(ORDERS, query)["segments"] == ["paid", "online"]
    narrowed = orders(paid=segment(filter.eq("status", "settled")))
    assert local_definition_identity([ORDERS]) != local_definition_identity([narrowed])


def test_served_requests_select_segments_by_name() -> None:
    from hypequery.serve.models import QueryRequest

    request = QueryRequest.model_validate({"measures": ["orders"], "segments": ["paid"]})
    assert request.semantic(limit=10).segments == ("paid",)
