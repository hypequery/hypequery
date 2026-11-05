"""`list_datasets` and `get_dataset_schema` answers from an authorized contract."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from ...protocol import ProtocolClientContract, ProtocolClientEndpoint

GENERIC_DESCRIPTION = "Authorized client endpoints."


def client_dataset_names(contract: ProtocolClientContract) -> list[str]:
    return sorted({endpoint["dataset"] for endpoint in contract["endpoints"]})


def _group(contract: ProtocolClientContract, dataset: str) -> list[ProtocolClientEndpoint]:
    return [endpoint for endpoint in contract["endpoints"] if endpoint["dataset"] == dataset]


def _group_text(
    endpoints: Sequence[ProtocolClientEndpoint], key: Literal["label", "description"]
) -> str | None:
    """Text from the dataset endpoint when visible, else any endpoint of the group."""

    ordered = [e for e in endpoints if e["kind"] == "dataset"] + [
        e for e in endpoints if e["kind"] == "metric"
    ]
    for endpoint in ordered:
        annotations = endpoint.get("annotations")
        if annotations is not None and key in annotations:
            return annotations[key]
    return None


def client_dataset_profile(contract: ProtocolClientContract, dataset: str) -> dict[str, object]:
    """Each endpoint's own permissions, never merged into a synthetic dataset."""

    endpoints = _group(contract, dataset)
    profile: dict[str, object] = {"name": dataset}
    label, description = _group_text(endpoints, "label"), _group_text(endpoints, "description")
    if label is not None:
        profile["label"] = label
    if description is not None:
        profile["description"] = description
    profile["queryable"] = any(e["kind"] == "dataset" for e in endpoints)
    profile["endpoints"] = [
        {key: value for key, value in e.items() if key not in ("path", "schemaHash")}
        for e in endpoints
    ]
    return profile


def client_dataset_list(contract: ProtocolClientContract) -> dict[str, object]:
    datasets: list[dict[str, object]] = []
    for name in client_dataset_names(contract):
        endpoints = _group(contract, name)
        entry: dict[str, object] = {"name": name}
        label = _group_text(endpoints, "label")
        if label is not None:
            entry["label"] = label
        description = _group_text(endpoints, "description")
        entry["description"] = GENERIC_DESCRIPTION if description is None else description
        entry["queryable"] = any(e["kind"] == "dataset" for e in endpoints)
        entry["dimensionCount"] = len({key for e in endpoints for key in e["dimensions"]})
        entry["measureCount"] = len({key for e in endpoints for key in e["measures"]})
        entry["metricCount"] = sum(1 for e in endpoints if e["kind"] == "metric")
        datasets.append(entry)
    return {"datasets": datasets, "total": len(datasets)}
