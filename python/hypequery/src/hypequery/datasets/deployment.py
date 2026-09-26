"""Build a validated RFC 0006 deployment from Python dataset definitions."""

from __future__ import annotations

from collections.abc import Mapping

from hypequery.protocol import (
    validate_protocol_dataset_contract,
    validate_protocol_deployment_contract,
)

from .constants import SEMANTIC_FILTER_OPERATORS
from .dataset import Dataset
from .deployment_values import filter_expression
from .dimensions import DimensionType
from .registry import DatasetRegistry
from .utils.portable_order import portable_name_key


def _field_schema(field_type: DimensionType | None) -> dict[str, str]:
    if field_type in ("string", "timestamp"):
        return {"kind": "string"}
    if field_type == "number":
        return {"kind": "number"}
    if field_type == "boolean":
        return {"kind": "boolean"}
    return {"kind": "any"}


def _sql_expression(
    sql: str, dependencies: tuple[str, ...] | None, output: dict[str, str], name: str
) -> dict[str, object]:
    if dependencies is None:
        raise ValueError(f'SQL-backed field "{name}" must declare dependencies.')
    return {
        "kind": "sql-expression",
        "dialect": "clickhouse",
        "sql": sql,
        "output": output,
        "dependencies": sorted(dependencies),
    }


def build_protocol_dataset_contract(
    dataset: Dataset, *, endpoint: Mapping[str, object] | None = None
) -> dict[str, object]:
    """Convert one definition to a validated local dataset snapshot."""

    dimensions: list[dict[str, object]] = []
    for name, dimension in sorted(
        dataset.dimensions.items(), key=lambda item: portable_name_key(item[0])
    ):
        source = (
            _sql_expression(
                dimension.sql, dimension.dependencies, _field_schema(dimension.field_type), name
            )
            if dimension.sql is not None
            else {"kind": "column", "column": dimension.column or name}
        )
        entry: dict[str, object] = {
            "name": name,
            "type": dimension.field_type,
            "source": source,
            "filterable": dimension.filterable is not False,
            "groupable": dimension.groupable is not False,
        }
        if dimension.label is not None:
            entry["label"] = dimension.label
        if dimension.description is not None:
            entry["description"] = dimension.description
        dimensions.append(entry)

    measures: list[dict[str, object]] = []
    for name, measure in sorted(
        dataset.measures.items(), key=lambda item: portable_name_key(item[0])
    ):
        entry = {
            "name": name,
            "aggregation": measure.aggregation,
            "field": measure.field,
            "filters": [filter_expression(item) for item in measure.filters or ()],
        }
        if measure.arg_field is not None:
            entry["argField"] = measure.arg_field
        if measure.level is not None:
            entry["level"] = measure.level
        if measure.sql is not None:
            field_type = dataset.dimensions.get(measure.field)
            entry["sql"] = _sql_expression(
                measure.sql,
                measure.dependencies,
                _field_schema(field_type.field_type if field_type is not None else None),
                name,
            )
        if measure.label is not None:
            entry["label"] = measure.label
        if measure.description is not None:
            entry["description"] = measure.description
        measures.append(entry)

    filters: list[dict[str, object]] = []
    for name, definition in sorted(
        dataset.filters.items(), key=lambda item: portable_name_key(item[0])
    ):
        item: dict[str, object] = {
            "name": name,
            "field": definition.field,
            "operators": list(definition.operators or SEMANTIC_FILTER_OPERATORS),
        }
        if definition.label is not None:
            item["label"] = definition.label
        if definition.description is not None:
            item["description"] = definition.description
        filters.append(item)

    relationships = [
        {
            "name": name,
            "kind": relation.kind,
            "target": relation.target,
            "from": relation.from_field,
            "to": relation.to_field,
            "queryable": relation.kind != "hasMany",
        }
        for name, relation in sorted(
            dataset.relationships.items(), key=lambda item: portable_name_key(item[0])
        )
    ]
    result: dict[str, object] = {
        "name": dataset.name,
        "source": dataset.source,
        "tenant": (
            {"kind": "required", "field": dataset.tenant_key}
            if dataset.tenant_key is not None
            else {"kind": "not-required"}
        ),
        "dimensions": dimensions,
        "measures": measures,
        "filters": filters,
        "metrics": [],
        "relationships": relationships,
    }
    if dataset.time_key is not None:
        result["timeField"] = dataset.time_key
    if dataset.limits is not None:
        limits = dataset.limits
        result["limits"] = {
            key: value
            for key, value in (
                ("maxDimensions", limits.max_dimensions),
                ("maxMeasures", limits.max_measures),
                ("maxFilters", limits.max_filters),
                ("maxResultSize", limits.max_result_size),
            )
            if value is not None
        }
    if endpoint is not None:
        result["endpoint"] = dict(endpoint)
    return validate_protocol_dataset_contract(result)


def build_protocol_deployment_contract(
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
) -> dict[str, object]:
    """Build and validate a dataset-only deployment contract.

    Every registered relationship target is included. Only datasets named in
    ``endpoints`` become directly queryable Cloud endpoints.
    """

    datasets = sorted(registry.get_all(), key=lambda item: portable_name_key(item.name))
    if endpoints is not None:
        unknown = set(endpoints) - {dataset.name for dataset in datasets}
        if unknown:
            raise ValueError(f"Endpoint names an unregistered dataset: {min(unknown)}")
    entries = []
    for dataset in datasets:
        snapshot = build_protocol_dataset_contract(
            dataset, endpoint=(endpoints or {}).get(dataset.name)
        )
        entries.append({key: value for key, value in snapshot.items() if key != "metrics"})
    return validate_protocol_deployment_contract(
        {"kind": "hypequery-deployment", "version": 2, "datasets": entries}
    )
