"""The strict shared HTTP/MCP client query profile."""

from __future__ import annotations

from typing import Literal, cast

from .errors import ProtocolClientContractError, client_error
from .models import ClientQueryPlan, ProtocolClientEndpoint
from .primitives import NULL_CHECK_OPERATORS, integer, record, shape, timezone
from .safe_data import snapshot_client_data
from .validate import validate_protocol_client_contract


def _array(value: object, maximum: int) -> list[object]:
    if type(value) is not list:
        client_error("HQ_CLIENT_QUERY")
    result = cast(list[object], value)
    if len(result) > maximum:
        client_error("HQ_CLIENT_QUERY")
    return result


def _strings(value: object, allowed: list[str], maximum: int) -> list[str]:
    items = _array(value, maximum)
    if any(type(item) is not str or item not in allowed for item in items):
        client_error("HQ_CLIENT_QUERY")
    result = cast(list[str], items)
    if len(set(result)) != len(result):
        client_error("HQ_CLIENT_QUERY")
    return result


def _predicate_value(value: object, kind: str, operator: str, maximum: int) -> None:
    values = (
        _array(value, 2 if operator == "between" else maximum)
        if operator in ("between", "in", "notIn")
        else [value]
    )
    if not values or (operator == "between" and len(values) != 2):
        client_error("HQ_CLIENT_QUERY")
    expected = (int, float) if kind == "number" else ((bool,) if kind == "boolean" else (str,))
    if any(type(item) not in expected for item in values):
        client_error("HQ_CLIENT_QUERY")


def _filters(endpoint: ProtocolClientEndpoint, source: dict[str, object]) -> list[object]:
    caps = endpoint["limits"]
    filters = _array(source.get("filters", []), caps["maxPredicates"])
    for item in filters:
        # A null check names no value (RFC 0023); one carrying `value` fails.
        null_check = record(item, "").get("operator") in NULL_CHECK_OPERATORS
        keys = ["field", "operator"] if null_check else ["field", "operator", "value"]
        condition = shape(item, keys, "")
        field = condition["field"]
        if type(field) is not str or field not in endpoint["filters"]:
            client_error("HQ_CLIENT_QUERY")
        definition = endpoint["filters"][field]
        operator = condition["operator"]
        if type(operator) is not str or operator not in definition["operators"]:
            client_error("HQ_CLIENT_QUERY")
        if not null_check:
            _predicate_value(
                condition["value"], definition["type"], operator, caps["maxFilterValues"]
            )
    return filters


def _having(
    endpoint: ProtocolClientEndpoint,
    source: dict[str, object],
    selected: list[str],
    filter_count: int,
) -> list[object]:
    caps = endpoint["limits"]
    having = _array(source.get("having", []), caps["maxPredicates"] - filter_count)
    for item in having:
        condition = shape(item, ["measure", "operator", "value"], "")
        field = condition["measure"]
        operator = condition["operator"]
        if (
            type(field) is not str
            or field not in selected
            or (not endpoint["measures"][field]["having"])
            or type(operator) is not str
            or operator not in ("eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "notIn")
        ):
            client_error("HQ_CLIENT_QUERY")
        _predicate_value(condition["value"], "number", operator, caps["maxFilterValues"])
    return having


def _order(
    endpoint: ProtocolClientEndpoint,
    source: dict[str, object],
    dimensions: list[str],
    selected: list[str],
) -> list[object]:
    order_by = _array(source.get("orderBy", []), endpoint["limits"]["maxOrderBy"])
    allowed = [key for key in dimensions if endpoint["dimensions"][key]["orderable"]]
    allowed.extend(selected)
    if "by" in source:
        allowed.append("period")
    ordered: set[str] = set()
    for item in order_by:
        order = shape(item, ["field", "direction"], "")
        field = order["field"]
        if (
            type(field) is not str
            or field not in allowed
            or field in ordered
            or (order["direction"] not in ("asc", "desc"))
        ):
            client_error("HQ_CLIENT_QUERY")
        ordered.add(field)
    return order_by


def _body(
    endpoint: ProtocolClientEndpoint, source: dict[str, object], transport: str
) -> ClientQueryPlan:
    keys = ["dimensions", "filters", "orderBy", "limit", "offset", "includeMeta"]
    if endpoint["kind"] == "dataset":
        keys.extend(["measures", "having"])
    time = endpoint["time"]
    if time is not None:
        keys.extend(["by", *(["timezone"] if time["timezone"] else [])])
    if any(key not in keys for key in source):
        client_error("HQ_CLIENT_QUERY")
    caps = endpoint["limits"]
    dimensions = _strings(
        source.get("dimensions", []),
        [key for key, field in endpoint["dimensions"].items() if field["groupable"]],
        caps["maxDimensions"],
    )
    selected = (
        list(endpoint["measures"])
        if endpoint["kind"] == "metric"
        else _strings(
            source.get("measures", endpoint["defaultMeasures"]),
            list(endpoint["measures"]),
            caps["maxMeasures"],
        )
    )
    if not dimensions and not selected and "by" not in source:
        client_error("HQ_CLIENT_QUERY")
    filters = _filters(endpoint, source)
    having = _having(endpoint, source, selected, len(filters))
    if "by" in source and (
        time is None or type(source["by"]) is not str or source["by"] not in time["grains"]
    ):
        client_error("HQ_CLIENT_QUERY")
    if "timezone" in source:
        timezone(source["timezone"], "/timezone")
    order_by = _order(endpoint, source, dimensions, selected)
    # HTTP clamps a larger limit; an agent is refused one, so it never reads a
    # silently shortened page as the whole answer.
    ceiling = caps["maxLimit"] if transport == "mcp" else 9007199254740991
    effective_limit = min(
        integer(source.get("limit", caps["defaultLimit"]), 1, ceiling, "/limit"),
        caps["maxLimit"],
    )
    offset = integer(source.get("offset", 0), 0, caps["maxOffset"], "/offset")
    if "includeMeta" in source and type(source["includeMeta"]) is not bool:
        client_error("HQ_CLIENT_QUERY")
    if source.get("includeMeta") is True and not endpoint["metadata"]:
        client_error("HQ_CLIENT_QUERY")
    body: dict[str, object] = {
        "dimensions": dimensions,
        "filters": filters,
        "orderBy": order_by,
        "limit": effective_limit,
        "offset": offset,
        "includeMeta": source.get("includeMeta", False),
    }
    if endpoint["kind"] == "dataset":
        body.update(measures=selected, having=having)
    for key in ("by", "timezone"):
        if key in source:
            body[key] = source[key]
    return {
        "endpoint": endpoint,
        "body": body,
        "selectedMeasures": selected,
        "effectiveLimit": effective_limit,
    }


def validate_protocol_client_query(
    contract: object,
    endpoint_id: str,
    value: object,
    transport: Literal["http", "mcp"] = "http",
) -> ClientQueryPlan:
    """Validate signed routing descriptors then normalize a strict client request."""
    validated = validate_protocol_client_contract(contract)
    try:
        endpoint = next(
            (item for item in validated["endpoints"] if item["id"] == endpoint_id), None
        )
        if endpoint is None:
            client_error("HQ_CLIENT_QUERY")
        source = record(snapshot_client_data(value), "")
        if transport == "mcp":
            if source.get("dataset") != endpoint["dataset"] or (
                source.get("metric") != endpoint["id"]
                if endpoint["kind"] == "metric"
                else "metric" in source
            ):
                client_error("HQ_CLIENT_QUERY")
            del source["dataset"]
            source.pop("metric", None)
            if "by" in source:
                client_error("HQ_CLIENT_QUERY")
            if "grain" in source:
                source["by"] = source.pop("grain")
        elif transport != "http":
            client_error("HQ_CLIENT_QUERY")
        return _body(endpoint, source, transport)
    except ProtocolClientContractError as error:
        client_error("HQ_CLIENT_QUERY", error.path)
