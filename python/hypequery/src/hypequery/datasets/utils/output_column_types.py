"""The logical type of each column a planned query returns.

Rows cross the driver boundary as JSON-safe scalars: decimals, dates and
datetimes arrive as strings. These types say what each column *means*, from the
dataset definition alone, so a DataFrame conversion can restore real dtypes
without guessing from values. They are computed from the query, not the rows,
so a cached result carries the same types as a fresh one.
"""

from __future__ import annotations

from typing import Literal, TypeAlias

from ..dataset import Dataset
from ..derived_measures import DerivedMeasure
from ..dimensions import DimensionType
from ..measures import Measure
from ..planner.errors import CompiledQueryError
from ..planner.query import DatasetQuery
from ..planner.resolution import (
    is_qualified,
    resolve_qualified_field,
    resolve_relationship_measure,
    selected_measure_names,
)
from ..registry import DatasetRegistry

#: ``number`` may arrive as an int, a float, or a decimal string. ``unknown`` is
#: a column whose type the definition cannot tell, such as ``min`` over a raw
#: column that no dimension describes; conversions leave it as returned.
ResultColumnType: TypeAlias = Literal[
    "string", "number", "integer", "boolean", "timestamp", "unknown"
]

_DIMENSION_TYPES: dict[DimensionType, ResultColumnType] = {
    "string": "string",
    "number": "number",
    "boolean": "boolean",
    "timestamp": "timestamp",
}


def _field_type(dataset: Dataset, field: str) -> ResultColumnType:
    dimension = dataset.dimensions.get(field)
    return _DIMENSION_TYPES[dimension.field_type] if dimension is not None else "unknown"


def _measure_type(dataset: Dataset, measure: Measure | DerivedMeasure) -> ResultColumnType:
    if isinstance(measure, DerivedMeasure):
        return "number"
    aggregation = measure.aggregation
    if aggregation in ("count", "countDistinct"):
        return "integer"
    if aggregation in ("min", "max", "argMax", "argMin"):
        # These return a value of the measured field itself.
        return "unknown" if measure.sql is not None else _field_type(dataset, measure.field)
    return "number"


def _dimension_column(
    dataset: Dataset, name: str, registry: DatasetRegistry | None
) -> ResultColumnType:
    if not is_qualified(name):
        return _field_type(dataset, name)
    if registry is None:
        return "unknown"
    return _DIMENSION_TYPES[
        resolve_qualified_field(dataset, name, registry=registry).dimension.field_type
    ]


def _measure_column(
    dataset: Dataset, name: str, registry: DatasetRegistry | None
) -> ResultColumnType:
    if not is_qualified(name):
        measure = dataset.measures.get(name)
        return "unknown" if measure is None else _measure_type(dataset, measure)
    if registry is None:
        return "unknown"
    resolved = resolve_relationship_measure(dataset, name, registry=registry)
    return _measure_type(resolved.target, resolved.measure)


def output_column_types(
    dataset: Dataset, query: DatasetQuery, registry: DatasetRegistry | None
) -> tuple[ResultColumnType, ...]:
    """One type per column of :func:`output_columns`, in the same order.

    Call it after the query planned; a name planning would reject reads as
    ``unknown`` rather than raising a second time.
    """

    types: list[ResultColumnType] = ["timestamp"] if query.by is not None else []
    for name in query.dimensions:
        try:
            types.append(_dimension_column(dataset, name, registry))
        except CompiledQueryError:
            types.append("unknown")
    for name in selected_measure_names(dataset, query):
        try:
            types.append(_measure_column(dataset, name, registry))
        except CompiledQueryError:
            types.append("unknown")
    return tuple(types)
