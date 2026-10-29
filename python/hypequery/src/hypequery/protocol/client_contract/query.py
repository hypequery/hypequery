"""The strict shared HTTP/MCP client query profile."""

from __future__ import annotations

from typing import Literal, cast

from .errors import ProtocolClientContractError, client_error
from .models import ClientQueryPlan, ProtocolClientEndpoint
from .primitives import NULL_CHECK_OPERATORS, integer, record, shape, timezone
from .safe_data import snapshot_client_data
from .validate import validate_protocol_client_contract


def _array(value: object, maximum: int, path: str) -> list[object]:
    if type(value) is not list:
        client_error("HQ_CLIENT_QUERY", path)
    result = cast(list[object], value)
    if len(result) > maximum:
        client_error("HQ_CLIENT_QUERY", path)
    return result


def _strings(value: object, allowed: list[str], maximum: int, path: str) -> list[str]:
    items = _array(value, maximum, path)
    seen: set[str] = set()
    for index, item in enumerate(items):
        if type(item) is not str or item not in allowed or item in seen:
            client_error("HQ_CLIENT_QUERY", f"{path}/{index}")
        seen.add(item)
    return cast(list[str], items)


def _predicate_value(value: object, kind: str, operator: str, maximum: int, path: str) -> None:
    values = (
        _array(value, 2 if operator == "between" else maximum, path)
        if operator in ("between", "in", "notIn")
        else [value]
    )
    if not values or (operator == "between" and len(values) != 2):
        client_error("HQ_CLIENT_QUERY", path)
    expected = (int, float) if kind == "number" else ((bool,) if kind == "boolean" else (str,))
    if any(type(item) not in expected for item in values):
        client_error("HQ_CLIENT_QUERY", path)


def _filters(endpoint: ProtocolClientEndpoint, source: dict[str, object]) -> list[object]:
    caps = endpoint["limits"]
    filters = _array(source.get("filters", []), caps["maxPredicates"], "/filters")
    for index, item in enumerate(filters):
        path = f"/filters/{index}"
        # A null check names no value (RFC 0023); one carrying `value` fails.
        null_check = record(item, path).get("operator") in NULL_CHECK_OPERATORS
        keys = ["field", "operator"] if null_check else ["field", "operator", "value"]
        condition = shape(item, keys, path)
        field = condition["field"]
        if type(field) is not str or field not in endpoint["filters"]:
            client_error("HQ_CLIENT_QUERY", f"{path}/field")
        definition = endpoint["filters"][field]
        operator = condition["operator"]
        if type(operator) is not str or operator not in definition["operators"]:
            client_error("HQ_CLIENT_QUERY", f"{path}/operator")
        if not null_check:
            _predicate_value(
                condition["value"],
                definition["type"],
                operator,
                caps["maxFilterValues"],
                f"{path}/value",
            )
    return filters


def _having(
    endpoint: ProtocolClientEndpoint,
    source: dict[str, object],
    selected: list[str],
    filter_count: int,
) -> list[object]:
    caps = endpoint["limits"]
    having = _array(source.get("having", []), caps["maxPredicates"] - filter_count, "/having")
    for index, item in enumerate(having):
        path = f"/having/{index}"
        condition = shape(item, ["measure", "operator", "value"], path)
        field = condition["measure"]
        operator = condition["operator"]
        if (
            type(field) is not str
            or field not in selected
            or (not endpoint["measures"][field]["having"])
        ):
            client_error("HQ_CLIENT_QUERY", f"{path}/measure")
        if type(operator) is not str or operator not in (
            "eq",
            "neq",
            "gt",
            "gte",
            "lt",
            "lte",
            "between",
            "in",
            "notIn",
        ):
            client_error("HQ_CLIENT_QUERY", f"{path}/operator")
        _predicate_value(
            condition["value"], "number", operator, caps["maxFilterValues"], f"{path}/value"
        )
    return having


def _order(
    endpoint: ProtocolClientEndpoint,
    source: dict[str, object],
    dimensions: list[str],
    selected: list[str],
) -> list[object]:
    order_by = _array(source.get("orderBy", []), endpoint["limits"]["maxOrderBy"], "/orderBy")
    allowed = [key for key in dimensions if endpoint["dimensions"][key]["orderable"]]
    allowed.extend(selected)
    if "by" in source:
        allowed.append("period")
    ordered: set[str] = set()
    for index, item in enumerate(order_by):
        path = f"/orderBy/{index}"
        order = shape(item, ["field", "direction"], path)
        field = order["field"]
        if type(field) is not str or field not in allowed or field in ordered:
            client_error("HQ_CLIENT_QUERY", f"{path}/field")
        if order["direction"] not in ("asc", "desc"):
            client_error("HQ_CLIENT_QUERY", f"{path}/direction")
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
    # An unknown member is reported at the root: its name is submitted data.
    if any(key not in keys for key in source):
        client_error("HQ_CLIENT_QUERY")
    caps = endpoint["limits"]
    dimensions = _strings(
        source.get("dimensions", []),
        [key for key, field in endpoint["dimensions"].items() if field["groupable"]],
        caps["maxDimensions"],
        "/dimensions",
    )
    selected = (
        list(endpoint["measures"])
        if endpoint["kind"] == "metric"
        else _strings(
            source.get("measures", endpoint["defaultMeasures"]),
            list(endpoint["measures"]),
            caps["maxMeasures"],
            "/measures",
        )
    )
    if not dimensions and not selected and "by" not in source:
        client_error("HQ_CLIENT_QUERY")
    filters = _filters(endpoint, source)
    having = _having(endpoint, source, selected, len(filters))
    if "by" in source and (
        time is None or type(source["by"]) is not str or source["by"] not in time["grains"]
    ):
        client_error("HQ_CLIENT_QUERY", "/by")
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
        client_error("HQ_CLIENT_QUERY", "/includeMeta")
    if source.get("includeMeta") is True and not endpoint["metadata"]:
        client_error("HQ_CLIENT_QUERY", "/includeMeta")
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
        # An agent names the time grain `grain`; point at the member it sent.
        path = error.path
        if transport == "mcp" and (path == "/by" or path.startswith("/by/")):
            path = "/grain" + path[3:]
        client_error("HQ_CLIENT_QUERY", path)
