"""Deterministic semantic contract over a set of datasets.

The contract is a normalized, sorted projection of the dataset catalog with a
version marker and a content hash. Object keys and unordered arrays are sorted
and SQL escape hatches are whitespace-normalized, so two logically equal models
produce identical JSON and identical hashes. Snapshots, diffs, CI checks, docs,
and codegen all read this one shape.
"""

from __future__ import annotations

import hashlib
import re
from typing import Final, cast

from .catalog import (
    DatasetCatalog,
    DimensionCatalogEntry,
    FilterCatalogEntry,
    MeasureCatalogEntry,
    RelationshipCatalogEntry,
    get_dataset_catalogs,
)
from .registry import DatasetRegistry
from .utils.canonical_json import sorted_record, unique_sorted
from .utils.stable_json import stable_json

#: Version of the semantic contract format. Bump when the serialized shape
#: changes in a way snapshot consumers must account for.
SEMANTIC_CONTRACT_VERSION: Final = 3

_TRAILING_SPACE = re.compile(r"[^\S\n]+$", re.MULTILINE)
_LEADING_SPACE = re.compile(r"^[^\S\n]*")


def _number(value: float) -> float | int:
    """Emit an integral value as an integer, the way a JSON number reads.

    The reference implementation has one number type, so `1` never serializes
    as `1.0`. Python would, and that byte difference would change the hash.
    """

    return int(value) if float(value).is_integer() else value


def normalize_sql(sql: str) -> str:
    """Normalize escape-hatch whitespace so equivalent SQL hashes identically."""

    lines = _TRAILING_SPACE.sub("", sql.replace("\r\n", "\n")).split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    indents = [
        len(cast(re.Match[str], _LEADING_SPACE.match(line)).group())
        for line in lines
        if line.strip()
    ]
    minimum = min(indents) if indents else 0
    return "\n".join(line[minimum:] for line in lines).strip()


def _dimension(entry: DimensionCatalogEntry, *, include_sql: bool) -> dict[str, object]:
    result: dict[str, object] = {"type": entry["type"]}
    if "column" in entry:
        result["column"] = entry["column"]
    if include_sql and "sql" in entry:
        result["sql"] = normalize_sql(entry["sql"])
    for key in ("label", "description"):
        if key in entry:
            result[key] = entry[key]
    result["filterable"] = entry["filterable"]
    result["groupable"] = entry["groupable"]
    return result


def _measure(entry: MeasureCatalogEntry, *, include_sql: bool) -> dict[str, object]:
    result: dict[str, object] = {
        "aggregation": entry["aggregation"],
        "field": entry["field"],
    }
    if "argField" in entry:
        result["argField"] = entry["argField"]
    if "level" in entry:
        result["level"] = _number(entry["level"])
    if include_sql and "sql" in entry:
        result["sql"] = normalize_sql(entry["sql"])
    for key in ("label", "description"):
        if key in entry:
            result[key] = entry[key]
    return result


def _filter(entry: FilterCatalogEntry) -> dict[str, object]:
    result: dict[str, object] = {"field": entry["field"]}
    for key in ("label", "description"):
        if key in entry:
            result[key] = entry[key]
    result["operators"] = unique_sorted(entry["operators"])
    if "valueType" in entry:
        result["valueType"] = entry["valueType"]
    return result


def _relationship(entry: RelationshipCatalogEntry) -> dict[str, object]:
    return {
        "kind": entry["kind"],
        "target": entry["target"],
        "from": entry["from"],
        "to": entry["to"],
        "queryable": entry["queryable"],
        "fields": unique_sorted(entry["fields"]),
    }


def _limits(limits: dict[str, int]) -> dict[str, object]:
    """Emit limits in a fixed key order.

    The authored order is not the contract's, so normalizing it keeps the hash
    stable for logically identical limits.
    """

    order = ("maxDimensions", "maxFilters", "maxMeasures", "maxResultSize")
    return {key: limits[key] for key in order if key in limits}


def _dataset(catalog: DatasetCatalog, *, include_sql: bool) -> dict[str, object]:
    result: dict[str, object] = {"name": catalog["name"], "source": catalog["source"]}
    for key in ("tenantKey", "timeKey"):
        if key in catalog:
            result[key] = catalog[key]
    result["requiresTenant"] = catalog["requiresTenant"]
    result["supportedGrains"] = unique_sorted(catalog["supportedGrains"])
    result["dimensions"] = sorted_record(
        {
            name: _dimension(entry, include_sql=include_sql)
            for name, entry in catalog["dimensions"].items()
        }
    )
    result["measures"] = sorted_record(
        {
            name: _measure(entry, include_sql=include_sql)
            for name, entry in catalog["measures"].items()
        }
    )
    # Python has no metric handles yet, so this is always empty; the key stays
    # so the serialized shape matches.
    result["metrics"] = sorted_record(catalog["metrics"])
    result["filters"] = sorted_record(
        {name: _filter(entry) for name, entry in catalog["filters"].items()}
    )
    result["relationships"] = sorted_record(
        {name: _relationship(entry) for name, entry in catalog["relationships"].items()}
    )
    if "limits" in catalog:
        result["limits"] = _limits(cast(dict[str, int], catalog["limits"]))
    return result


def serialize_semantic_contract(
    registry: DatasetRegistry, *, include_sql: bool = True
) -> dict[str, object]:
    """Build a deterministic semantic contract from a registry's datasets.

    `include_sql` defaults to True for trusted contexts — snapshots, CI,
    codegen — where the SQL already lives in the author's source. Pass False
    when serving the contract to untrusted consumers, so internal SQL never
    reaches them.
    """

    catalogs = get_dataset_catalogs(registry)
    contract: dict[str, object] = {
        "version": SEMANTIC_CONTRACT_VERSION,
        "datasets": sorted_record(
            {name: _dataset(catalog, include_sql=include_sql) for name, catalog in catalogs.items()}
        ),
    }
    return {**contract, "contentHash": hash_contract(contract)}


def contract_to_stable_json(contract: dict[str, object]) -> str:
    """Serialize a contract with stable formatting, for writing and hashing."""

    return stable_json(contract)


def hash_contract(contract: dict[str, object]) -> str:
    """Compute the SHA-256 content hash of a normalized contract."""

    return hashlib.sha256(contract_to_stable_json(contract).encode("utf-8")).hexdigest()
