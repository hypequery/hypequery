"""Relationship definition model and helpers.

A relationship joins on one column pair (`from_field`/`to_field`) or on a
composite key: several pairs that must all be equal (RFC 0016). A composite
relationship keeps `from_field`/`to_field` as its first pair, so a reader that
predates composite keys sees a valid record, and carries every pair in `keys`.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Literal, Protocol, TypeAlias

from pydantic import field_validator, model_validator

from ._base import DefinitionModel
from .validation import validate_identifier


class DatasetTarget(Protocol):
    """Minimum definition surface accepted by relationship helpers."""

    name: str


RelationshipKind: TypeAlias = Literal["belongsTo", "hasMany", "hasOne"]
RelationshipTarget: TypeAlias = DatasetTarget | Callable[[], DatasetTarget]


class RelationshipKey(DefinitionModel):
    """One physical source/target column equality in a relationship key."""

    from_field: str
    to_field: str

    @field_validator("from_field", "to_field")
    @classmethod
    def _valid_identifier(cls, value: str) -> str:
        return validate_identifier(value)


#: A key pair as authored: a `RelationshipKey` or a `(from, to)` tuple.
RelationshipKeyInput: TypeAlias = RelationshipKey | tuple[str, str]


class Relationship(DefinitionModel):
    """A relationship whose target callback has already been resolved."""

    kind: RelationshipKind
    target: str
    from_field: str
    to_field: str
    keys: tuple[RelationshipKey, ...] | None = None

    @field_validator("target", "from_field", "to_field")
    @classmethod
    def _valid_identifier(cls, value: str) -> str:
        return validate_identifier(value)

    @model_validator(mode="after")
    def _valid_keys(self) -> Relationship:
        if self.keys is None:
            return self
        if not self.keys:
            raise ValueError("relationship keys must be a non-empty sequence")
        first = self.keys[0]
        if (first.from_field, first.to_field) != (self.from_field, self.to_field):
            raise ValueError("from_field and to_field must match the first relationship key")
        sources = {key.from_field for key in self.keys}
        targets = {key.to_field for key in self.keys}
        if len(sources) != len(self.keys) or len(targets) != len(self.keys):
            raise ValueError("relationship keys must not repeat a source or target column")
        return self

    @property
    def key_pairs(self) -> tuple[RelationshipKey, ...]:
        """Every equality the join requires, for single and composite keys alike."""

        if self.keys is not None:
            return self.keys
        return (RelationshipKey(from_field=self.from_field, to_field=self.to_field),)


def _key(value: RelationshipKeyInput) -> RelationshipKey:
    if isinstance(value, RelationshipKey):
        return value
    if type(value) is not tuple or len(value) != 2:
        raise TypeError("a relationship key is a RelationshipKey or a (from, to) tuple")
    return RelationshipKey(from_field=value[0], to_field=value[1])


def _relationship(
    kind: RelationshipKind,
    target: RelationshipTarget,
    *,
    from_field: str | None,
    to_field: str | None,
    keys: Sequence[RelationshipKeyInput] | None,
) -> Relationship:
    resolved = target() if callable(target) else target
    if keys is None:
        if from_field is None or to_field is None:
            raise TypeError("a relationship needs from_field and to_field, or keys")
        return Relationship(
            kind=kind, target=resolved.name, from_field=from_field, to_field=to_field
        )
    if from_field is not None or to_field is not None:
        raise TypeError("relationship keys cannot be combined with from_field/to_field")
    pairs = tuple(_key(value) for value in keys)
    if not pairs:
        raise ValueError("relationship keys must be a non-empty sequence")
    # A single pair is the legacy relationship: contracts and catalogs carry
    # `keys` only for composite relationships, however the pair was authored.
    return Relationship(
        kind=kind,
        target=resolved.name,
        from_field=pairs[0].from_field,
        to_field=pairs[0].to_field,
        keys=pairs if len(pairs) > 1 else None,
    )


def belongs_to(
    target: RelationshipTarget,
    *,
    from_field: str | None = None,
    to_field: str | None = None,
    keys: Sequence[RelationshipKeyInput] | None = None,
) -> Relationship:
    """Define a many-to-one relationship with a foreign key on this dataset."""

    return _relationship("belongsTo", target, from_field=from_field, to_field=to_field, keys=keys)


def has_many(
    target: RelationshipTarget,
    *,
    from_field: str | None = None,
    to_field: str | None = None,
    keys: Sequence[RelationshipKeyInput] | None = None,
) -> Relationship:
    """Define a metadata-only one-to-many relationship."""

    return _relationship("hasMany", target, from_field=from_field, to_field=to_field, keys=keys)


def has_one(
    target: RelationshipTarget,
    *,
    from_field: str | None = None,
    to_field: str | None = None,
    keys: Sequence[RelationshipKeyInput] | None = None,
) -> Relationship:
    """Define a one-to-one relationship."""

    return _relationship("hasOne", target, from_field=from_field, to_field=to_field, keys=keys)
