"""How a dataset's rows are resolved before anything reads them (RFC 0021).

ReplacingMergeTree and CollapsingMergeTree tables keep superseded row versions
until a background merge removes them, so a plain read double counts. A
dataset with a `RowResolution` reads its source with `FINAL`, which resolves
versions at query time, and, when the engine is named, keeps only current
rows: not deleted (`deleted_column = 0`) or positive (`sign_column = 1`).
"""

from __future__ import annotations

from typing import Literal

from pydantic import field_validator, model_validator

from ._base import DefinitionModel
from .validation import validate_identifier

RowResolutionEngine = Literal["replacing", "collapsing", "versioned-collapsing"]


class RowResolution(DefinitionModel):
    """`FINAL`, optionally with the engine's current-row column."""

    kind: Literal["final"] = "final"
    engine: RowResolutionEngine | None = None
    deleted_column: str | None = None
    sign_column: str | None = None

    @field_validator("deleted_column", "sign_column")
    @classmethod
    def _valid_column(cls, value: str | None) -> str | None:
        return None if value is None else validate_identifier(value)

    @model_validator(mode="after")
    def _columns_match_engine(self) -> RowResolution:
        if self.engine is None and (self.deleted_column or self.sign_column):
            raise ValueError("a column needs the engine it belongs to")
        if self.engine == "replacing" and self.sign_column is not None:
            raise ValueError("a replacing engine has a deleted_column, not a sign_column")
        if self.engine in ("collapsing", "versioned-collapsing"):
            if self.sign_column is None:
                raise ValueError(f"a {self.engine} engine needs its sign_column")
            if self.deleted_column is not None:
                raise ValueError(f"a {self.engine} engine has a sign_column, not a deleted_column")
        return self

    @property
    def current_row(self) -> tuple[str, int] | None:
        """The column and value that mark a current row after `FINAL`, if any."""

        if self.engine == "replacing":
            return None if self.deleted_column is None else (self.deleted_column, 0)
        if self.sign_column is not None:
            return (self.sign_column, 1)
        return None

    def to_protocol(self) -> dict[str, object]:
        """The deployment and catalog shape: `{ kind, engine?, deletedColumn? | signColumn? }`."""

        node: dict[str, object] = {"kind": "final"}
        if self.engine is not None:
            node["engine"] = self.engine
        if self.deleted_column is not None:
            node["deletedColumn"] = self.deleted_column
        if self.sign_column is not None:
            node["signColumn"] = self.sign_column
        return node


class _ResolvedRows:
    """Row-resolution constructors: `resolved_rows.replacing(deleted_column="is_deleted")`."""

    @staticmethod
    def final() -> RowResolution:
        """Read the source with `FINAL` and apply no other filter."""
        return RowResolution()

    @staticmethod
    def replacing(*, deleted_column: str | None = None) -> RowResolution:
        """A ReplacingMergeTree; *deleted_column* rows equal to 1 are dropped."""
        return RowResolution(engine="replacing", deleted_column=deleted_column)

    @staticmethod
    def collapsing(*, sign_column: str) -> RowResolution:
        """A CollapsingMergeTree; only positive *sign_column* rows remain."""
        return RowResolution(engine="collapsing", sign_column=sign_column)

    @staticmethod
    def versioned_collapsing(*, sign_column: str) -> RowResolution:
        """A VersionedCollapsingMergeTree; only positive *sign_column* rows remain."""
        return RowResolution(engine="versioned-collapsing", sign_column=sign_column)


resolved_rows = _ResolvedRows()
