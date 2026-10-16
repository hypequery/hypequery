"""Allowlisted public fields and filters, resolved directly from definitions."""

from __future__ import annotations

from ...protocol import ClientDimension, ClientFilter, ClientMeasure
from ..dataset import Dataset, FilterDefinition
from ..derived_measures import DerivedMeasure
from ..dimensions import Dimension
from ..measures import Measure
from ..registry import DatasetRegistry
from ..utils.definition_projection import filter_operators
from ..utils.relationship_fields import list_queryable_relationship_fields
from ..utils.relationship_measures import list_relationship_measures


def dimension_descriptor(dimension: Dimension, *, related: bool = False) -> ClientDimension:
    kind = dimension.field_type
    return {
        "type": kind,
        "wireType": "number-or-string"
        if kind == "number"
        else ("boolean" if kind == "boolean" else "string"),
        "nullable": True if related else "unknown",
        "groupable": dimension.groupable is not False,
        "orderable": dimension.groupable is not False,
    }


def numeric_measure(dataset: Dataset, measure: Measure | DerivedMeasure) -> bool:
    if isinstance(measure, DerivedMeasure):
        return True
    if measure.aggregation in ("min", "max", "argMin", "argMax"):
        dimension = dataset.dimensions.get(measure.field)
        return dimension is not None and dimension.field_type == "number"
    return True


def measure_descriptor(dataset: Dataset, measure: Measure | DerivedMeasure) -> ClientMeasure:
    return {"wireType": "string", "nullable": True, "having": numeric_measure(dataset, measure)}


def filter_descriptor(dimension: Dimension, definition: FilterDefinition) -> ClientFilter | None:
    allowed = filter_operators(definition)
    if dimension.field_type == "boolean":
        allowed = [op for op in allowed if op in ("eq", "neq", "in", "notIn")]
    elif dimension.field_type == "number":
        allowed = [op for op in allowed if op != "like"]
    if not allowed:
        return None
    return {"type": dimension.field_type, "operators": sorted(set(allowed))}


def request_filter(dataset: Dataset, field: str) -> bool:
    """Tenant identities cannot be supplied as semantic request predicates."""
    dimension = dataset.dimensions[field]
    return dataset.tenant_key is None or (dimension.column or field) != dataset.tenant_key


def public_fields(
    dataset: Dataset, registry: DatasetRegistry | None
) -> tuple[dict[str, ClientDimension], dict[str, ClientMeasure], dict[str, ClientFilter]]:
    dimensions = {name: dimension_descriptor(d) for name, d in dataset.dimensions.items()}
    measures = {name: measure_descriptor(dataset, m) for name, m in dataset.measures.items()}
    filters: dict[str, ClientFilter] = {}
    related_filters: dict[str, ClientFilter] = {}
    for relation_name, relationship in dataset.relationships.items():
        if relationship.kind not in ("belongsTo", "hasOne"):
            continue
        if registry is None:
            raise ValueError("client export requires a registry for queryable relationships")
        target = registry.require(relationship.target)
        for qualified in list_queryable_relationship_fields(relation_name, relationship, target):
            field = qualified.split(".", 1)[1]
            dimensions[qualified] = dimension_descriptor(target.dimensions[field], related=True)
            definition = target.filters.get(field)
            if (
                definition is not None
                and definition.field == field
                and request_filter(target, field)
            ):
                descriptor = filter_descriptor(target.dimensions[field], definition)
                if descriptor is not None:
                    related_filters[qualified] = descriptor
        measures.update(
            {
                name: measure_descriptor(target, measure)
                for name, measure in list_relationship_measures(
                    relation_name, relationship, target
                ).items()
            }
        )
    filters.update(related_filters)
    for name, definition in dataset.filters.items():
        if "." in definition.field:
            # Planner permission comes from the target's direct filter, not its catalog presence.
            descriptor = related_filters.get(definition.field)
            if descriptor is not None:
                allowed = filter_operators(definition)
                operators: list[str] = [op for op in descriptor["operators"] if op in allowed]
                if operators:
                    filters[name] = {"type": descriptor["type"], "operators": operators}
        else:
            dimension = dataset.dimensions.get(definition.field)
            if dimension is None:
                raise ValueError("client export filter references an unknown dimension")
            if request_filter(dataset, definition.field):
                descriptor = filter_descriptor(dimension, definition)
                if descriptor is not None:
                    filters[name] = descriptor
    return dimensions, measures, filters
