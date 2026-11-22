"""RFC 0027 event-dataset declaration: who acted, and optionally what happened."""

from __future__ import annotations

from .deployment_primitives import exact_fields, identifier, record
from .errors import deployment_error


def dataset_events(
    value: object,
    path: str,
    dimensions: list[dict[str, object]],
    time_field: object,
) -> dict[str, object]:
    """Validate ``events`` against the dataset's own dimensions and time field.

    The event timestamp is always the dataset's ``timeField``, so it must be
    one of the dataset's timestamp dimensions.
    """

    node = record(value, path)
    exact_fields(node, ("entity",), ("event",), path)
    entity = identifier(node["entity"], f"{path}.entity")
    event = identifier(node["event"], f"{path}.event") if "event" in node else None

    by_name = {str(dimension["name"]): dimension for dimension in dimensions}
    entity_dimension = by_name.get(entity)
    if entity_dimension is None:
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.entity")
    # Distinct entities are counted per group: a groupable value, not a time.
    if entity_dimension.get("groupable") is not True or entity_dimension.get("type") not in (
        "string",
        "number",
    ):
        deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.entity")
    if event is not None:
        event_dimension = by_name.get(event)
        if event_dimension is None:
            deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", f"{path}.event")
        if event_dimension.get("filterable") is not True or event_dimension.get("type") != "string":
            deployment_error("HQ_DEPLOYMENT_INVALID_VALUE", f"{path}.event")
    time = by_name.get(str(time_field)) if time_field is not None else None
    if time is None or time.get("type") != "timestamp":
        deployment_error("HQ_DEPLOYMENT_INVALID_REFERENCE", path)
    result: dict[str, object] = {"entity": entity}
    if event is not None:
        result["event"] = event
    return result
