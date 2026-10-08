"""Immutable formulas over measures owned by one dataset."""

from __future__ import annotations

from typing import Literal

from pydantic import model_validator

from ._base import DefinitionModel
from .formulas import Formula, compile_formula


class DerivedMeasure(DefinitionModel):
    kind: Literal["derived"] = "derived"
    formula: Formula
    label: str | None = None
    description: str | None = None

    @model_validator(mode="after")
    def _portable_formula(self) -> DerivedMeasure:
        compile_formula(self.formula)
        return self
