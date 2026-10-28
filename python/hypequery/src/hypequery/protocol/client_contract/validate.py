"""Client surface validation independent of execution and serving frameworks."""

from typing import cast

from .bounds import bound_client_descriptors
from .codec import CLIENT_CONTRACT_DOMAIN, CLIENT_SCHEMA_DOMAIN, client_digest
from .errors import client_error
from .models import PreparedProtocolClientContract, ProtocolClientContract, ProtocolClientEndpoint
from .nodes import annotations, dimension, fields, filter_descriptor, limits, measure, time
from .primitives import boolean, choice, name, names, pointer, record, route, shape
from .safe_data import client_canonical, snapshot_client_data

ENDPOINT_FIELDS = [
    "id",
    "kind",
    "dataset",
    "path",
    "dimensions",
    "measures",
    "filters",
    "time",
    "metadata",
    "limits",
]


def _endpoint(value: object, path: str, *, signed: bool) -> dict[str, object]:
    raw = record(value, path)
    kind = choice(raw.get("kind"), ["dataset", "metric"], pointer(path, "kind"))
    annotated = "annotations" in raw
    node = shape(
        raw,
        [
            *ENDPOINT_FIELDS,
            *(["defaultMeasures"] if kind == "dataset" else []),
            *(["annotations"] if annotated else []),
            *(["schemaHash"] if signed else []),
        ],
        path,
    )
    result: dict[str, object] = {
        "id": name(node["id"], pointer(path, "id")),
        "kind": kind,
        "dataset": name(node["dataset"], pointer(path, "dataset")),
        "path": route(node["path"], pointer(path, "path")),
        "dimensions": fields(node["dimensions"], pointer(path, "dimensions"), dimension),
        "measures": fields(node["measures"], pointer(path, "measures"), measure),
        "filters": fields(node["filters"], pointer(path, "filters"), filter_descriptor),
        "time": time(node["time"], pointer(path, "time")),
        "metadata": boolean(node["metadata"], pointer(path, "metadata")),
        "limits": limits(node["limits"], pointer(path, "limits")),
    }
    if kind == "dataset":
        result["defaultMeasures"] = names(node["defaultMeasures"], pointer(path, "defaultMeasures"))
    if annotated:
        result["annotations"] = annotations(node["annotations"], pointer(path, "annotations"))
    if signed:
        result["schemaHash"] = node["schemaHash"]
    return result


def _references(value: dict[str, object], path: str) -> None:
    item = cast(ProtocolClientEndpoint, value)
    if (item["kind"] == "dataset") != (item["id"] == item["dataset"]):
        client_error("HQ_CLIENT_REFERENCE", path)
    if item["kind"] == "metric" and (
        len(item["measures"]) != 1 or any(m["having"] for m in item["measures"].values())
    ):
        client_error("HQ_CLIENT_SHAPE", path)
    for key, field in item["dimensions"].items():
        if "." in key and field["nullable"] is not True:
            client_error("HQ_CLIENT_SHAPE", pointer(pointer(path, "dimensions"), key))
    if any(key in item["measures"] for key in item["dimensions"]) or (
        item["time"] is not None
        and ("period" in item["dimensions"] or "period" in item["measures"])
    ):
        client_error("HQ_CLIENT_REFERENCE", path)
    defaults = item["defaultMeasures"] if item["kind"] == "dataset" else list(item["measures"])
    if any(key not in item["measures"] for key in defaults) or (
        len(defaults) > item["limits"]["maxMeasures"]
        or item["limits"]["defaultLimit"] > item["limits"]["maxLimit"]
    ):
        client_error("HQ_CLIENT_REFERENCE", path)
    described = item.get("annotations", {}).get("fields", {})
    if any(key not in item["dimensions"] and key not in item["measures"] for key in described):
        client_error("HQ_CLIENT_REFERENCE", path)


def _contract(value: object, *, signed: bool) -> PreparedProtocolClientContract:
    raw = record(snapshot_client_data(value), "")
    bound_client_descriptors(raw)
    if raw.get("kind") != "hypequery-client-contract" or (
        type(raw.get("version")) is not int or raw["version"] != 1
    ):
        client_error("HQ_CLIENT_VERSION")
    root = shape(
        raw, ["kind", "version", "view", "endpoints", *(["contentHash"] if signed else [])], ""
    )
    view = choice(root["view"], ["build", "authorized"], "/view")
    if type(root["endpoints"]) is not list:
        client_error("HQ_CLIENT_SHAPE", "/endpoints")
    raw_endpoints = cast(list[object], root["endpoints"])
    if len(raw_endpoints) > 256:
        client_error("HQ_CLIENT_LIMIT", "/endpoints")
    endpoints = [
        _endpoint(item, "/endpoints/" + str(index), signed=signed)
        for index, item in enumerate(raw_endpoints)
    ]
    ids: set[object] = set()
    paths: set[object] = set()
    for index, item in enumerate(endpoints):
        path = "/endpoints/" + str(index)
        if item["id"] in ids or item["path"] in paths:
            client_error("HQ_CLIENT_DUPLICATE", path)
        ids.add(item["id"])
        paths.add(item["path"])
    for index, item in enumerate(endpoints):
        _references(item, "/endpoints/" + str(index))
    endpoints.sort(key=lambda item: cast(str, item["id"]))
    for index, item in enumerate(endpoints):
        schema = {
            key: entry
            for key, entry in item.items()
            if key not in ("schemaHash", "limits", "annotations")
        }
        digest = client_digest(CLIENT_SCHEMA_DOMAIN, schema)
        if signed and item["schemaHash"] != digest:
            client_error("HQ_CLIENT_IDENTITY", "/endpoints/" + str(index) + "/schemaHash")
        item["schemaHash"] = digest
    body: dict[str, object] = {
        "kind": "hypequery-client-contract",
        "version": 1,
        "view": view,
        "endpoints": endpoints,
    }
    content_hash = client_digest(CLIENT_CONTRACT_DOMAIN, body)
    if signed and root["contentHash"] != content_hash:
        client_error("HQ_CLIENT_IDENTITY", "/contentHash")
    body["contentHash"] = content_hash
    return {
        "contract": cast(ProtocolClientContract, body),
        "canonical": client_canonical(body),
        "contentHash": content_hash,
    }


def validate_protocol_client_contract(value: object) -> ProtocolClientContract:
    """Validate signed input and return detached built-in data."""
    return _contract(value, signed=True)["contract"]


def prepare_protocol_client_contract(value: object) -> PreparedProtocolClientContract:
    """Normalize unsigned input and compute identities; supplied identities are refused."""
    return _contract(value, signed=False)
