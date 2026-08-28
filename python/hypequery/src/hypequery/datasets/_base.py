"""Shared configuration for immutable dataset definition values."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Self

from pydantic import BaseModel, ConfigDict


class DefinitionModel(BaseModel):
    """A strict, immutable, JSON-serializable definition value."""

    model_config = ConfigDict(
        strict=True,
        extra="forbid",
        frozen=True,
        allow_inf_nan=False,
    )

    def model_copy(
        self,
        *,
        update: Mapping[str, object] | None = None,
        deep: bool = False,
    ) -> Self:
        """Copy definitions without Pydantic's unvalidated update escape hatch."""

        if update is not None:
            raise TypeError(
                "definition models do not support model_copy(update=...); "
                "construct a new validated model instead"
            )
        return super().model_copy(deep=deep)
