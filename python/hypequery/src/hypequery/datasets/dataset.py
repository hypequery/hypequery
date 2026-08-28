"""Strict dataset definition model."""

from __future__ import annotations

from typing import Literal, TypeAlias, cast

from pydantic import Field, field_validator, model_validator

from ._base import DefinitionModel
from .dimensions import Dimension
from .measures import Measure
from .query_helpers import FilterOperator
from .relationships import Relationship
from .validation import (
    validate_identifier,
    validate_identifier_map,
    validate_non_empty,
    validate_qualified_identifier,
)


class FilterDefinition(DefinitionModel):
    """A named filter exposed by a dataset definition."""

    field: str
    label: str | None = None
    description: str | None = None
    operators: tuple[FilterOperator, ...] | None = None

    @field_validator("field")
    @classmethod
    def _valid_field(cls, value: str) -> str:
        return validate_qualified_identifier(value)


class DatasetLimits(DefinitionModel):
    """Optional per-dataset semantic query limits."""

    max_dimensions: int | None = Field(default=None, ge=0)
    max_measures: int | None = Field(default=None, ge=0)
    max_filters: int | None = Field(default=None, ge=0)
    max_result_size: int | None = Field(default=None, ge=0)


DefinitionMap: TypeAlias = dict[str, Dimension | Measure | FilterDefinition | Relationship]


class Dataset(DefinitionModel):
    """A normalized semantic model over one physical source."""

    kind: Literal["dataset"] = "dataset"
    name: str
    source: str
    tenant_key: str | None = None
    time_key: str | None = None
    dimensions: dict[str, Dimension]
    measures: dict[str, Measure] = Field(default_factory=dict)
    filters: dict[str, FilterDefinition] = Field(default_factory=dict)
    relationships: dict[str, Relationship] = Field(default_factory=dict)
    limits: DatasetLimits | None = None

    @model_validator(mode="before")
    @classmethod
    def _default_filters(cls, value: object) -> object:
        if type(value) is not dict or "filters" in value:
            return value
        data = cast(dict[str, object], value).copy()
        raw_dimensions = data.get("dimensions")
        if type(raw_dimensions) is not dict:
            return data

        defaults: dict[str, FilterDefinition] = {}
        for name, raw_definition in cast(dict[object, object], raw_dimensions).items():
            if type(name) is not str:
                continue
            filterable = (
                raw_definition.filterable
                if isinstance(raw_definition, Dimension)
                else cast(dict[str, object], raw_definition).get("filterable")
                if type(raw_definition) is dict
                else None
            )
            if filterable is not False:
                defaults[name] = FilterDefinition(field=name)
        data["filters"] = defaults
        return data

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        return validate_identifier(value)

    @field_validator("source", "tenant_key", "time_key")
    @classmethod
    def _non_empty_physical_name(cls, value: str | None, info: object) -> str | None:
        if value is None:
            return None
        field_name = getattr(info, "field_name", "value")
        return validate_non_empty(value, field=str(field_name))

    @model_validator(mode="after")
    def _valid_definition_names(self) -> Dataset:
        maps: tuple[DefinitionMap, ...] = (
            cast(DefinitionMap, self.dimensions),
            cast(DefinitionMap, self.measures),
            cast(DefinitionMap, self.filters),
            cast(DefinitionMap, self.relationships),
        )
        for definitions in maps:
            validate_identifier_map(definitions)
        if self.source in self.relationships:
            raise ValueError("relationship name must not match the dataset source")
        return self
