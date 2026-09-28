"""Map a Python dataset execution onto the RFC 0009 cache preimage inputs."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable

from hypequery.protocol import tuple_value

from ..dataset import Dataset
from ..deployment_values import canonical_filter_value
from ..planner import DatasetQuery, ExecutionContext
from ..query_helpers import Filter

_LOCAL_DEFINITION_DOMAIN = b"hypequery.python.local-definitions.v1\x00"
_MAX_EXACT_BINARY64_INTEGER = 2**53


def _binary64_literal(value: object) -> object:
    """Give a Python integer the number semantics a TypeScript caller has.

    RFC 0001 numbers are binary64, so `5` from Python and `5` from TypeScript
    must build the same preimage. An integer that binary64 cannot hold exactly
    has no such spelling and makes the call uncacheable.
    """

    if type(value) is int:
        if abs(value) > _MAX_EXACT_BINARY64_INTEGER:
            raise ValueError("integer filter value is not exactly representable as binary64")
        return float(value)
    if type(value) is tuple:
        return tuple(_binary64_literal(item) for item in value)
    return value


def _filter_node(item: Filter) -> dict[str, object]:
    value = _binary64_literal(item.value)
    if item.operator == "between" and type(value) is tuple:
        # RFC 0003 bounds are a two-item tuple; in/notIn take an array.
        literal: object = tuple_value([canonical_filter_value(bound) for bound in value])
    else:
        literal = canonical_filter_value(value)
    return {
        "kind": "comparison",
        "operator": item.operator,
        "left": {"kind": "reference", "name": item.field},
        "right": {"kind": "literal", "value": literal},
    }


def wire_query(dataset: Dataset, query: DatasetQuery) -> dict[str, object]:
    """The RFC 0003 dataset query this execution answers."""

    wire: dict[str, object] = {"kind": "dataset", "dataset": dataset.name}
    if query.dimensions:
        wire["dimensions"] = list(query.dimensions)
    if query.measures is not None:
        wire["measures"] = list(query.measures)
    if query.filters:
        wire["filters"] = [_filter_node(item) for item in query.filters]
    if query.order_by:
        wire["orderBy"] = [
            {"field": item.field, "direction": item.direction} for item in query.order_by
        ]
    if query.by is not None:
        wire["by"] = query.by
    if query.limit is not None:
        wire["limit"] = query.limit
    if query.offset is not None:
        wire["offset"] = query.offset
    return wire


def tenant_scope(context: ExecutionContext | None) -> dict[str, object]:
    """The capability present on the execution, whether or not it is applied."""

    scope = context.tenant if context is not None else None
    if scope is None:
        return {"mode": "none"}
    if scope.cross_tenant:
        return {"mode": "all"}
    return {"mode": "scoped", "ids": list(scope.ids)}


def effective_row_limit(dataset: Dataset, query: DatasetQuery) -> int | None:
    """The fewest rows the planner will return: the query or dataset cap."""

    caps = [
        cap
        for cap in (query.limit, dataset.limits.max_result_size if dataset.limits else None)
        if cap is not None
    ]
    return min(caps) if caps else None


def local_definition_identity(datasets: Iterable[Dataset]) -> str:
    """A digest over every definition an execution could touch.

    RFC 0009 leaves the local identity implementation-defined. This one covers
    the full model of each dataset (sources, SQL, tenant keys, relationships,
    and limits), so any change that could alter rows changes the identity.
    Local entries are therefore never shared with released deployments or with
    other implementations, which costs only misses.
    """

    models = {dataset.name: dataset.model_dump(mode="json") for dataset in datasets}
    encoded = json.dumps(models, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(_LOCAL_DEFINITION_DOMAIN + encoded.encode("utf-8")).hexdigest()
