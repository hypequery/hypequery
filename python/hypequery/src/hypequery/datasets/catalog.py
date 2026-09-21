"""Dataset catalog generation.

A catalog is the public, serializable description of a dataset: what can be
grouped, filtered, aggregated, and ordered. It carries no physical detail
beyond the column and SQL a definition already declares, and it is the shape
serving, agent tooling, and generated clients read.

The emitted keys are the protocol's camelCase spellings, and absent optional
values are omitted rather than emitted as null, so a Python catalog is
byte-comparable with the TypeScript one for the same model.
"""

from __future__ import annotations

from typing import NotRequired, TypedDict, cast

from .constants import SEMANTIC_FILTER_OPERATORS, SUPPORTED_TIME_GRAINS
from .dataset import Dataset, DatasetLimits, FilterDefinition
from .dimensions import Dimension, DimensionType
from .measures import Measure
from .query_helpers import FilterOperator
from .registry import DatasetRegistry
from .relationships import Relationship, RelationshipKind
from .utils.relationship_fields import (
    list_groupable_relationship_fields,
    list_queryable_relationship_fields,
)


class DimensionCatalogEntry(TypedDict):
    type: DimensionType
    column: NotRequired[str]
    sql: NotRequired[str]
    label: NotRequired[str]
    description: NotRequired[str]
    filterable: bool
    groupable: bool


class MeasureCatalogEntry(TypedDict):
    aggregation: str
    field: str
    argField: NotRequired[str]
    level: NotRequired[float]
    sql: NotRequired[str]
    label: NotRequired[str]
    description: NotRequired[str]
    filterCount: int


class FilterCatalogEntry(TypedDict):
    field: str
    label: NotRequired[str]
    description: NotRequired[str]
    operators: list[FilterOperator]
    valueType: NotRequired[DimensionType]


# `from` is a Python keyword, so this one needs the functional spelling.
RelationshipCatalogEntry = TypedDict(
    "RelationshipCatalogEntry",
    {
        "kind": RelationshipKind,
        "target": str,
        "from": str,
        "to": str,
        "queryable": bool,
        "fields": list[str],
        "groupableFields": list[str],
    },
)


class DatasetLimitsEntry(TypedDict):
    maxDimensions: NotRequired[int]
    maxMeasures: NotRequired[int]
    maxFilters: NotRequired[int]
    maxResultSize: NotRequired[int]


class DatasetCatalog(TypedDict):
    name: str
    source: str
    tenantKey: NotRequired[str]
    timeKey: NotRequired[str]
    dimensions: dict[str, DimensionCatalogEntry]
    measures: dict[str, MeasureCatalogEntry]
    metrics: dict[str, object]
    filters: dict[str, FilterCatalogEntry]
    relationships: dict[str, RelationshipCatalogEntry]
    limits: NotRequired[DatasetLimitsEntry]
    requiresTenant: bool
    supportedGrains: list[str]
    orderableFields: list[str]
    maxLimit: NotRequired[int]


def _present(**values: object) -> dict[str, object]:
    """Keep only the values a definition actually declared.

    The reference implementation emits `undefined` for an absent optional and
    `JSON.stringify` drops the key; omitting it here is the same contract.
    """

    return {key: value for key, value in values.items() if value is not None}


def _dimension_entry(dimension: Dimension) -> DimensionCatalogEntry:
    entry: dict[str, object] = {"type": dimension.field_type}
    entry.update(
        _present(
            column=dimension.column,
            sql=dimension.sql,
            label=dimension.label,
            description=dimension.description,
        )
    )
    entry["filterable"] = dimension.filterable is not False
    entry["groupable"] = dimension.groupable is not False
    return cast(DimensionCatalogEntry, entry)


def _measure_entry(measure: Measure) -> MeasureCatalogEntry:
    entry: dict[str, object] = {"aggregation": measure.aggregation, "field": measure.field}
    entry.update(
        _present(
            argField=measure.arg_field,
            level=measure.level,
            sql=measure.sql,
            label=measure.label,
            description=measure.description,
        )
    )
    entry["filterCount"] = len(measure.filters or ())
    return cast(MeasureCatalogEntry, entry)


def _filter_entry(
    definition: FilterDefinition, dimensions: dict[str, Dimension]
) -> FilterCatalogEntry:
    entry: dict[str, object] = {"field": definition.field}
    entry.update(_present(label=definition.label, description=definition.description))
    entry["operators"] = list(definition.operators or SEMANTIC_FILTER_OPERATORS)
    declared = dimensions.get(definition.field)
    if declared is not None:
        entry["valueType"] = declared.field_type
    return cast(FilterCatalogEntry, entry)


def _relationship_entry(
    name: str, relationship: Relationship, target: Dataset
) -> RelationshipCatalogEntry:
    return cast(
        RelationshipCatalogEntry,
        {
            "kind": relationship.kind,
            "target": relationship.target,
            "from": relationship.from_field,
            "to": relationship.to_field,
            "queryable": relationship.kind != "hasMany",
            "fields": list(list_queryable_relationship_fields(name, relationship, target)),
            "groupableFields": list(list_groupable_relationship_fields(name, relationship, target)),
        },
    )


def _limits_entry(limits: DatasetLimits) -> DatasetLimitsEntry:
    return cast(
        DatasetLimitsEntry,
        _present(
            maxDimensions=limits.max_dimensions,
            maxMeasures=limits.max_measures,
            maxFilters=limits.max_filters,
            maxResultSize=limits.max_result_size,
        ),
    )


def get_dataset_catalog(dataset: Dataset, *, registry: DatasetRegistry) -> DatasetCatalog:
    """Describe one dataset as catalog metadata.

    *registry* resolves relationship targets; a relationship pointing at an
    unregistered dataset is a definition error and raises.
    """

    dimensions = dict(dataset.dimensions)
    relationships = {
        name: _relationship_entry(name, relationship, registry.require(relationship.target))
        for name, relationship in dataset.relationships.items()
    }

    catalog: dict[str, object] = {"name": dataset.name, "source": dataset.source}
    catalog.update(_present(tenantKey=dataset.tenant_key, timeKey=dataset.time_key))
    catalog["dimensions"] = {
        name: _dimension_entry(dimension) for name, dimension in dimensions.items()
    }
    catalog["measures"] = {
        name: _measure_entry(measure) for name, measure in dataset.measures.items()
    }
    # Python has no metric definitions yet; the key stays so the shape matches.
    catalog["metrics"] = {}
    catalog["filters"] = {
        name: _filter_entry(definition, dimensions) for name, definition in dataset.filters.items()
    }
    catalog["relationships"] = relationships
    if dataset.limits is not None:
        catalog["limits"] = _limits_entry(dataset.limits)
    catalog["requiresTenant"] = dataset.tenant_key is not None
    catalog["supportedGrains"] = list(SUPPORTED_TIME_GRAINS) if dataset.time_key else []
    catalog["orderableFields"] = [
        *dimensions,
        *dataset.measures,
        *(field for entry in relationships.values() for field in entry["fields"]),
        *(["period"] if dataset.time_key else []),
    ]
    if dataset.limits is not None and dataset.limits.max_result_size is not None:
        catalog["maxLimit"] = dataset.limits.max_result_size
    return cast(DatasetCatalog, catalog)


def get_dataset_catalogs(registry: DatasetRegistry) -> dict[str, DatasetCatalog]:
    """Describe every registered dataset, keyed by dataset name."""

    return {
        dataset.name: get_dataset_catalog(dataset, registry=registry)
        for dataset in registry.get_all()
    }


def get_queryable_relationship_fields(catalog: DatasetCatalog) -> list[str]:
    """Every queryable relationship field name a catalog advertises."""

    return [
        field
        for entry in catalog["relationships"].values()
        if entry["queryable"]
        for field in entry["fields"]
    ]


def get_groupable_relationship_fields(catalog: DatasetCatalog) -> list[str]:
    """The queryable relationship fields a catalog also allows as grouping keys."""

    return [
        field
        for entry in catalog["relationships"].values()
        if entry["queryable"]
        for field in entry["groupableFields"]
    ]
