"""Build a validated RFC 0006 deployment from Python dataset definitions."""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from hypequery.protocol import (
    validate_protocol_dataset_contract,
    validate_protocol_deployment_contract,
)

from .dataset import Dataset
from .deployment_values import filter_expression
from .derived_measures import DerivedMeasure
from .dimensions import DimensionType
from .registry import DatasetRegistry
from .relationships import Relationship
from .utils.definition_projection import (
    filter_operators,
    is_queryable,
    limits_node,
    metadata,
    relationship_node,
)
from .utils.derived_measures import derived_measure_node, formula_references
from .utils.portable_grains import assert_publishable_time_grains
from .utils.portable_order import portable_name_key


def _field_schema(field_type: DimensionType | None) -> dict[str, str]:
    if field_type in ("string", "timestamp"):
        return {"kind": "string"}
    if field_type == "number":
        return {"kind": "number"}
    if field_type == "boolean":
        return {"kind": "boolean"}
    return {"kind": "any"}


def _relationship_node(name: str, relation: Relationship) -> dict[str, object]:
    return {"name": name, **relationship_node(relation), "queryable": is_queryable(relation)}


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

    # Contract 2 cannot carry an allowed-grain policy. Refuse a restriction
    # rather than turn it into an unrestricted deployed dataset.
    assert_publishable_time_grains(dataset.name, dataset.time_grains)
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
            **metadata(dimension.label, dimension.description),
        }
        dimensions.append(entry)

    measures: list[dict[str, object]] = []
    for name, measure in sorted(
        dataset.measures.items(), key=lambda item: portable_name_key(item[0])
    ):
        if isinstance(measure, DerivedMeasure):
            continue
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
        entry.update(metadata(measure.label, measure.description))
        measures.append(entry)

    filters: list[dict[str, object]] = []
    for name, definition in sorted(
        dataset.filters.items(), key=lambda item: portable_name_key(item[0])
    ):
        filters.append(
            {
                "name": name,
                "field": definition.field,
                "operators": filter_operators(definition),
                **metadata(definition.label, definition.description),
            }
        )

    relationships = [
        _relationship_node(name, relation)
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
        result["limits"] = limits_node(dataset.limits)
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
    for dataset in datasets:
        for definition in dataset.measures.values():
            if isinstance(definition, DerivedMeasure) and any(
                isinstance(dataset.measures[reference], DerivedMeasure)
                for reference in formula_references(definition.formula)
            ):
                raise ValueError(
                    "Deployment contract 2 requires derived measures to reference base measures."
                )
    entries = []
    for dataset in datasets:
        snapshot = build_protocol_dataset_contract(
            dataset, endpoint=(endpoints or {}).get(dataset.name)
        )
        entry = {key: value for key, value in snapshot.items() if key != "metrics"}
        measures = [
            *cast(list[dict[str, object]], snapshot["measures"]),
            *(
                derived_measure_node(name, measure)
                for name, measure in dataset.measures.items()
                if isinstance(measure, DerivedMeasure)
            ),
        ]
        entry["measures"] = measures
        entries.append(entry)
    return validate_protocol_deployment_contract(
        {"kind": "hypequery-deployment", "version": 2, "datasets": entries}
    )
