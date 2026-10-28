"""Presentation text for client endpoints, resolved from the same definitions as fields."""

from __future__ import annotations

from collections.abc import Iterable

from ...protocol import ClientEndpointAnnotations, ClientFieldAnnotation
from ...protocol.js_strings import is_js_blank
from ..dataset import Dataset
from ..derived_measures import DerivedMeasure
from ..dimensions import Dimension
from ..measures import Measure
from ..registry import DatasetRegistry


def annotation_text(value: str | None) -> str | None:
    """Fold whitespace runs so multi-line definitions stay advertisable; omit blank text."""
    if value is None:
        return None
    folded = " ".join(value.split())
    return None if not folded or is_js_blank(folded) else folded


def field_annotation(
    definition: Dimension | Measure | DerivedMeasure,
) -> ClientFieldAnnotation | None:
    node: ClientFieldAnnotation = {}
    label = annotation_text(definition.label)
    description = annotation_text(definition.description)
    if label is not None:
        node["label"] = label
    if description is not None:
        node["description"] = description
    return node or None


def _definition(
    dataset: Dataset, registry: DatasetRegistry | None, key: str, *, measure: bool
) -> Dimension | Measure | DerivedMeasure | None:
    owner, field = dataset, key
    if "." in key:
        relation, field = key.split(".", 1)
        relationship = dataset.relationships.get(relation)
        if relationship is None or registry is None:
            return None
        owner = registry.require(relationship.target)
    return owner.measures.get(field) if measure else owner.dimensions.get(field)


def endpoint_annotations(
    dataset: Dataset,
    registry: DatasetRegistry | None,
    dimensions: Iterable[str],
    measures: Iterable[str],
    metric: str | None = None,
) -> ClientEndpointAnnotations | None:
    """Group text from the dataset; field text for each advertised dimension/measure key.

    A metric endpoint's sole measure key is its public alias, so its text comes
    from *metric*, the local measure it serves.
    """
    fields: dict[str, ClientFieldAnnotation] = {}
    for key in dimensions:
        definition = _definition(dataset, registry, key, measure=False)
        if definition is not None and (node := field_annotation(definition)) is not None:
            fields[key] = node
    for key in measures:
        definition = (
            dataset.measures.get(metric)
            if metric is not None
            else _definition(dataset, registry, key, measure=True)
        )
        if definition is not None and (node := field_annotation(definition)) is not None:
            fields[key] = node
    result: ClientEndpointAnnotations = {}
    label = annotation_text(dataset.label)
    description = annotation_text(dataset.description)
    if label is not None:
        result["label"] = label
    if description is not None:
        result["description"] = description
    if fields:
        result["fields"] = fields
    return result or None
