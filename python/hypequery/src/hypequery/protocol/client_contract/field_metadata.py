"""Reduce a contract to the field annotations consumers without field metadata accept."""

from __future__ import annotations

from .models import (
    ClientEndpointAnnotations,
    ClientFieldAnnotation,
    PreparedProtocolClientContract,
)
from .validate import prepare_protocol_client_contract


def _field_text(field: ClientFieldAnnotation) -> ClientFieldAnnotation | None:
    node: ClientFieldAnnotation = {}
    if "label" in field:
        node["label"] = field["label"]
    if "description" in field:
        node["description"] = field["description"]
    return node or None


def _text_only(annotations: ClientEndpointAnnotations) -> ClientEndpointAnnotations | None:
    result: ClientEndpointAnnotations = {}
    if "label" in annotations:
        result["label"] = annotations["label"]
    if "description" in annotations:
        result["description"] = annotations["description"]
    fields = {
        key: text
        for key, field in annotations.get("fields", {}).items()
        if (text := _field_text(field)) is not None
    }
    if fields:
        result["fields"] = fields
    return result or None


def without_client_field_metadata(
    prepared: PreparedProtocolClientContract,
) -> PreparedProtocolClientContract:
    """The same contract and view without field synonyms, examples, format, unit and currency.

    For a consumer that did not ask for field metadata. Field entries, ``fields``
    and ``annotations`` left empty are omitted, so the result has one canonical
    encoding; every schemaHash is unchanged and the contentHash is recomputed.
    """
    contract = prepared["contract"]
    endpoints: list[dict[str, object]] = []
    for endpoint in contract["endpoints"]:
        node = {
            key: value
            for key, value in endpoint.items()
            if key not in ("schemaHash", "annotations")
        }
        annotations = endpoint.get("annotations")
        if annotations is not None and (text := _text_only(annotations)) is not None:
            node["annotations"] = text
        endpoints.append(node)
    return prepare_protocol_client_contract(
        {
            "kind": contract["kind"],
            "version": contract["version"],
            "view": contract["view"],
            "endpoints": endpoints,
        }
    )
