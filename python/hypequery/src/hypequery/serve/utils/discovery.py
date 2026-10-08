"""Allowlisted logical discovery, matching TypeScript's agent-safe projection."""

from __future__ import annotations

import json

from ...datasets.catalog import DatasetCatalog, get_dataset_catalogs
from ...datasets.registry import DatasetRegistry


def _dataset(catalog: DatasetCatalog) -> dict[str, object]:
    dimensions = [
        {
            "name": name,
            "type": entry["type"],
            **{key: entry[key] for key in ("label", "description") if key in entry},
            "filterable": entry["filterable"],
            "groupable": entry["groupable"],
        }
        for name, entry in sorted(catalog["dimensions"].items())
        if entry["filterable"] or entry["groupable"]
    ]
    names = {entry["name"] for entry in dimensions}
    return {
        "name": catalog["name"],
        "description": catalog["name"] + " analytics dataset.",
        "timeDimension": catalog.get("timeKey") if catalog.get("timeKey") in names else None,
        "dimensions": dimensions,
        "measures": [
            {"name": name, **{key: entry[key] for key in ("label", "description") if key in entry}}
            for name, entry in sorted(
                [
                    *catalog["measures"].items(),
                    *(
                        item
                        for relationship in catalog["relationships"].values()
                        if relationship["queryable"]
                        for item in relationship.get("measures", {}).items()
                    ),
                ]
            )
        ],
        "metrics": [],
        "filters": [
            {
                "name": name,
                "type": entry["valueType"],
                **{key: entry[key] for key in ("label", "description") if key in entry},
                "operators": sorted(set(entry["operators"])),
            }
            for name, entry in sorted(catalog["filters"].items())
            if "valueType" in entry and entry["field"] in names
        ],
        "relationships": [
            {"name": name, "target": entry["target"], "fields": sorted(set(entry["fields"]))}
            for name, entry in sorted(catalog["relationships"].items())
            if entry["queryable"]
        ],
        "limits": dict(catalog.get("limits", {})),
    }


def public_discovery(registry: DatasetRegistry, max_bytes: int = 256 * 1024) -> dict[str, object]:
    if type(max_bytes) is not int or max_bytes < 1:
        raise ValueError("max_bytes must be a positive integer")
    projection: dict[str, object] = {
        "datasets": [
            _dataset(catalog) for _, catalog in sorted(get_dataset_catalogs(registry).items())
        ]
    }
    if len(json.dumps(projection, ensure_ascii=False, separators=(",", ":")).encode()) > max_bytes:
        raise ValueError("discovery exceeds the byte budget")
    return projection
