"""Shared configuration for immutable dataset definition values."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DefinitionModel(BaseModel):
    """A strict, immutable, JSON-serializable definition value."""

    model_config = ConfigDict(
        strict=True,
        extra="forbid",
        frozen=True,
        allow_inf_nan=False,
    )
