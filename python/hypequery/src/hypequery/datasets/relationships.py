"""Relationship definition model and helpers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal, Protocol, TypeAlias

from pydantic import field_validator

from ._base import DefinitionModel
from .validation import validate_identifier


class DatasetTarget(Protocol):
    """Minimum definition surface accepted by relationship helpers."""

    name: str


RelationshipKind: TypeAlias = Literal["belongsTo", "hasMany", "hasOne"]
RelationshipTarget: TypeAlias = DatasetTarget | Callable[[], DatasetTarget]


class Relationship(DefinitionModel):
    """A relationship whose target callback has already been resolved."""

    kind: RelationshipKind
    target: str
    from_field: str
    to_field: str

    @field_validator("target", "from_field", "to_field")
    @classmethod
    def _valid_identifier(cls, value: str) -> str:
        return validate_identifier(value)


def _relationship(
    kind: RelationshipKind,
    target: RelationshipTarget,
    *,
    from_field: str,
    to_field: str,
) -> Relationship:
    resolved = target() if callable(target) else target
    return Relationship(
        kind=kind,
        target=resolved.name,
        from_field=from_field,
        to_field=to_field,
    )


def belongs_to(target: RelationshipTarget, *, from_field: str, to_field: str) -> Relationship:
    """Define a many-to-one relationship with a foreign key on this dataset."""

    return _relationship("belongsTo", target, from_field=from_field, to_field=to_field)


def has_many(target: RelationshipTarget, *, from_field: str, to_field: str) -> Relationship:
    """Define a metadata-only one-to-many relationship."""

    return _relationship("hasMany", target, from_field=from_field, to_field=to_field)


def has_one(target: RelationshipTarget, *, from_field: str, to_field: str) -> Relationship:
    """Define a one-to-one relationship."""

    return _relationship("hasOne", target, from_field=from_field, to_field=to_field)
